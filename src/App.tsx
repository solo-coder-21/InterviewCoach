import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Header from "./components/Header";
import HomePage from "./pages/HomePage";
import InterviewPage from "./pages/InterviewPage";
import ResultsPage from "./pages/ResultsPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import { AIStatusProvider } from "./context/AIStatusContext";
import { ThemeProvider } from "./context/ThemeContext";
import AIStatusModal from "./components/AIStatusModal";
import { AuthProvider, RequireAuth } from "./context/AuthContext";
import AuthPage from "./pages/AuthPage";
import PricingPage from "./pages/PricingPage";
import AccountPage from "./pages/AccountPage";
import SyncNotice from "./components/SyncNotice";

export default function App() {
  return (
    <ThemeProvider>
      <AIStatusProvider>
        <BrowserRouter>
          <AuthProvider>
          <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
            <Header />
            <SyncNotice />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/interview" element={<RequireAuth><InterviewPage /></RequireAuth>} />
              <Route path="/results" element={<RequireAuth><ResultsPage /></RequireAuth>} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
            </Routes>
            <AIStatusModal />
            <Analytics />
          </div>
          </AuthProvider>
        </BrowserRouter>
      </AIStatusProvider>
    </ThemeProvider>
  );
}
