import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { AppLayout } from "@/components/layout/AppLayout";

const HomePage = lazy(() => import("./pages/HomePage"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage"));
const AddTransactionPage = lazy(() => import("./pages/AddTransactionPage"));
const DebtsPage = lazy(() => import("./pages/DebtsPage"));
const GoalsPage = lazy(() => import("./pages/GoalsPage"));
const HealthPage = lazy(() => import("./pages/HealthPage"));
const AssistantPage = lazy(() => import("./pages/AssistantPage"));
const MorePage = lazy(() => import("./pages/MorePage"));
const CarChecksPage = lazy(() => import("./pages/CarChecksPage"));
const RemindersPage = lazy(() => import("./pages/RemindersPage"));
const NotesPage = lazy(() => import("./pages/NotesPage"));
const SOSPage = lazy(() => import("./pages/SOSPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DataBackupPage = lazy(() => import("./pages/DataBackupPage"));
const FinanceAIPage = lazy(() => import("./pages/FinanceAIPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminPostsPage = lazy(() => import("./pages/admin/AdminPostsPage"));
const AdminCategoriesPage = lazy(() => import("./pages/admin/AdminCategoriesPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  if (loading) return <RouteLoader />;

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <AppLayout />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <I18nProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<RouteLoader />}>
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
                    <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                  </Route>
                  <Route element={<ProtectedRoutes />}>
                    <Route element={<AdminLayout />}>
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/posts" element={<AdminPostsPage />} />
                      <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

