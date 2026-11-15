import { Link } from 'react-router-dom';
import { Coins } from 'lucide-react';
import type { InterviewSession } from '../utils/storage';
export default function AICostReport({ session }: { session: InterviewSession }) {
  return <div className="card space-y-3">
    <h3 className="font-semibold flex items-center gap-2"><Coins size={19} className="text-primary" />One interview credit used</h3>
    <p className="text-sm text-foreground/65">This session was included in your purchased credits. There are no additional per-question, voice, or report charges.</p>
    <p className="text-xs text-foreground/60">Session reference: {session.id}</p>
    <Link className="text-primary text-sm underline" to="/account">View your balance and payment history</Link>
  </div>;
}
