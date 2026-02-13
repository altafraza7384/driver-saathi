import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { AppLayout } from "@/components/layout/AppLayout";
import HomePage from "./pages/HomePage";
import TransactionsPage from "./pages/TransactionsPage";
import HealthPage from "./pages/HealthPage";
import AssistantPage from "./pages/AssistantPage";
import MorePage from "./pages/MorePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/health" element={<HealthPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/more" element={<MorePage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
