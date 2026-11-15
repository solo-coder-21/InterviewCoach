import { randomUUID } from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { authenticated, checked, database, HttpError, interviewId, limit, ownedInterview, text, uuidPattern } from './database.js';
import { handleAIChat, type AIResponse } from './ai.js';

export async function runAI(body: any) {
  let status = 200;
  let output: any;
  const response: AIResponse = {
    status(code) { status = code; return response; },
    json(data) { output = data; },
  };
  await handleAIChat({ body }, response);
  if (status >= 400 || !output) throw new HttpError(502, 'Interview processing failed. Please try again.');
  return output;
}
export function configuration(body: any) {
  const track = body?.interviewTrack || 'full';
  if (!['full', 'resume', 'technical', 'behavioral', 'ai'].includes(track)) throw new HttpError(400, 'Choose a valid interview track.');
  return {
    resumeText: text(body?.resumeText, 'resume', 50000),
    role: text(body?.role, 'role', 120),
    company: text(body?.company, 'company', 120),
    experienceLevel: text(body?.experienceLevel || 'Fresher / Entry Level (0 Years)', 'experience level', 120),
    interviewTrack: track,
  };
}
export function entitled(action: string, max: number): RequestHandler[] {
  return [authenticated, async (req, res, next) => {
    try {
      const id = interviewId(req);
      const row = await ownedInterview(res.locals.user.id, id);
      checked(await database().rpc('claim_interview_usage', { p_user: res.locals.user.id, p_id: id, p_action: action, p_max: max }));
      res.locals.interview = row;
      next();
    } catch (error) { next(error); }
  }];
}
export function mountAccounts(app: Express) {
  app.get('/api/account', authenticated, async (_req, res) => {
    const id = res.locals.user.id;
    checked(await database().rpc('recover_interviews', { p_user: id }));
    const [wallet, purchases, interviews] = await Promise.all([
      database().from('wallets').select('credits').eq('user_id', id).single(),
      database().from('purchases').select('id,plan_id,amount,credits,status,razorpay_order_id,razorpay_payment_id,created_at,paid_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
      database().from('interviews').select('id,status,created_at,session_data->role,session_data->company,session_data->scores').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    ]);
    res.json({ credits: checked(wallet)?.credits ?? 0, purchases: checked(purchases) || [], interviews: checked(interviews) || [] });
  });
  app.post('/api/interviews', authenticated, async (req, res) => {
    const userId = res.locals.user.id;
    const config = configuration(req.body);
    const id = req.body?.requestId;
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw new HttpError(400, 'A valid request ID is required.');
    await limit(userId, 'start', 10, 60);
    const reserved = checked(await database().rpc('reserve_interview', { p_user: userId, p_id: id, p_configuration: config }));
    if (!reserved.created) {
      if (reserved.interview.session_data) { res.json({ session: reserved.interview.session_data }); return; }
      throw new HttpError(409, reserved.interview.status === 'generating'
        ? 'This interview is still being prepared. Check your account shortly. A stalled start is restored after 10 minutes.'
        : 'This interview could not be prepared. Its credit was restored. Start a new interview.');
    }
    try {
      const generated = await runAI({ ...config, action: 'generate-questions' });
      if (!Array.isArray(generated.questions) || generated.questions.length < 10
        || generated.questions.slice(0, 10).some((q: any) => typeof (typeof q === 'string' ? q : q?.text) !== 'string'
          || !(typeof q === 'string' ? q : q.text).trim())) throw new Error('Incomplete questions generated');
      // Resume scoring is optional; a scoring outage must not discard a generated interview.
      let resumeScore;
      try { resumeScore = await runAI({ ...config, action: 'score-resume' }); } catch { /* available later in the report */ }
      const session = {
        ...config, id, ownerId: userId,
        candidateName: typeof generated.candidateName === 'string' ? generated.candidateName.split(/\s+/)[0] : undefined,
        questions: generated.questions.slice(0, 10).map((q: any) => ({ ...(typeof q === 'string' ? { text: q } : q), id: randomUUID() })),
        currentQuestionIndex: 0, status: 'in_progress', resumeScore,
        questionSource: generated.source, snippetsCount: generated.snippetsCount,
        createdAt: reserved.interview.created_at,
      };
      checked(await database().rpc('finish_generation', { p_user: userId, p_id: id, p_session: session }));
      res.json({ session });
    } catch (error) {
      // A crashed worker is also recovered by recover_interviews on the next account visit.
      try { checked(await database().rpc('finish_generation', { p_user: userId, p_id: id, p_session: null })); }
      catch (refundError) { console.error('Generation recovery pending:', refundError instanceof Error ? refundError.message : 'Unknown'); }
      throw error instanceof HttpError ? error : new HttpError(502, 'Interview generation failed. Your credit will be restored automatically.');
    }
  });
  app.get('/api/interviews/:id', authenticated, async (req, res) => {
    const id = String(req.params.id);
    if (!uuidPattern.test(id)) throw new HttpError(400, 'Invalid interview ID.');
    const row = await ownedInterview(res.locals.user.id, id);
    res.json({ session: row.session_data, status: row.status });
  });
  app.put('/api/interviews/:id', authenticated, async (req, res) => {
    const id = String(req.params.id);
    if (!uuidPattern.test(id)) throw new HttpError(400, 'Invalid interview ID.');
    const row = await ownedInterview(res.locals.user.id, id);
    if (!row.session_data) throw new HttpError(409, 'This interview is not ready.');
    if (row.status !== 'active') { res.json({ session: row.session_data }); return; }
    const draft = req.body;
    const data = row.session_data;
    if (!Array.isArray(draft?.questions)) throw new HttpError(400, 'Invalid interview progress.');
    const allowed = ['answerTranscript', 'followUpQuestion', 'followUpAnswerTranscript', 'isProbed', 'score', 'relevance', 'clarity', 'depth', 'confidence', 'feedback', 'writtenCode', 'timeToAnswerSeconds'];
    data.questions = data.questions.map((q: any) => {
      const update = draft.questions.find((item: any) => item.id === q.id);
      if (!update) return q;
      for (const key of allowed) {
        const value = update[key];
        if (typeof value === 'string' && value.length <= 30000 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') q[key] = value;
      }
      return q;
    });
    data.currentQuestionIndex = Math.max(0, Math.min(data.questions.length - 1, Number.isInteger(draft.currentQuestionIndex) ? draft.currentQuestionIndex : 0));
    if (draft.status === 'completed') {
      data.status = 'completed';
      // Reports are user-owned practice records, never a source of payment or entitlement decisions.
      if (draft.scores && typeof draft.scores === 'object') data.scores = draft.scores;
    }
    const updated = checked(await database().from('interviews').update({ session_data: data, status: data.status === 'completed' ? 'completed' : 'active', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', res.locals.user.id).eq('status', 'active').select('session_data').maybeSingle());
    res.json({ session: updated?.session_data || (await ownedInterview(res.locals.user.id, id)).session_data });
  });
  app.post('/api/google-ai-chat', ...entitled('ai', 45), async (req, res) => {
    const row = res.locals.interview;
    const action = req.body?.action;
    if (!['score-answer', 'summarize-interview'].includes(action)) throw new HttpError(400, 'Start a new interview to generate questions or score a resume.');
    const body = { ...req.body, ...row.configuration, action };
    if (action === 'score-answer') {
      const question = row.session_data.questions.find((q: any) => q.id === req.body.questionId);
      if (!question) throw new HttpError(400, 'Choose a question from this interview.');
      checked(await database().rpc('claim_interview_usage', { p_user: res.locals.user.id, p_id: row.id, p_action: `question:${question.id}`, p_max: 4 }));
      body.question = question.text;
      body.answer = text(req.body.answer || '', 'answer', 30000, false);
      body.writtenCode = text(req.body.writtenCode || '', 'code', 30000, false);
    } else {
      if (!Array.isArray(body.sessionQuestions) || body.sessionQuestions.length > 10) throw new HttpError(400, 'Invalid interview answers.');
      checked(await database().rpc('claim_interview_usage', { p_user: res.locals.user.id, p_id: row.id, p_action: 'summary', p_max: 3 }));
    }
    res.json(await runAI(body));
  });
}
