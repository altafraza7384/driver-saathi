import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { AppLayout } from "@/components/layout/AppLayout";
import HomePage from "./pages/HomePage";
import TransactionsPage from "./pages/TransactionsPage";
import AddTransactionPage from "./pages/AddTransactionPage";
import DebtsPage from "./pages/DebtsPage";
import GoalsPage from "./pages/GoalsPage";
import HealthPage from "./pages/HealthPage";
import AssistantPage from "./pages/AssistantPage";
import MorePage from "./pages/MorePage";
import CarChecksPage from "./pages/CarChecksPage";
import RemindersPage from "./pages/RemindersPage";
import NotesPage from "./pages/NotesPage";
import SOSPage from "./pages/SOSPage";
import SettingsPage from "./pages/SettingsPage";
import DataBackupPage from "./pages/DataBackupPage";
import FinanceAIPage from "./pages/FinanceAIPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminPostsPage from "./pages/admin/AdminPostsPage";
import AdminCategoriesPage from "./pages/admin/AdminCategoriesPage";
import { FCMService } from "@/services/fcm.service";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <AppLayout />;
}

const App = () => {
  // Initialize FCM when app starts (only on native platforms)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      console.log('🚀 Initializing FCM...');
      FCMService.initialize();
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <I18nProvider>
          <AuthProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                  <Route path="/auth" element={<AuthPage />} />
                  <Route element={<ProtectedRoutes />}>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/transactions" element={<TransactionsPage />} />
                    <Route path="/transactions/add" element={<AddTransactionPage />} />
                    <Route path="/debts" element={<DebtsPage />} />
                    <Route path="/goals" element={<GoalsPage />} />
                    <Route path="/health" element={<HealthPage />} />
                    <Route path="/assistant" element={<AssistantPage />} />
                    <Route path="/more" element={<MorePage />} />
                    <Route path="/car-checks" element={<CarChecksPage />} />
                    <Route path="/reminders" element={<RemindersPage />} />
                    <Route path="/notes" element={<NotesPage />} />
                    <Route path="/sos" element={<SOSPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/data-backup" element={<DataBackupPage />} />
                    <Route path="/finance-ai" element={<FinanceAIPage />} />
                  </Route>
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/posts" element={<AdminPostsPage />} />
                    <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
