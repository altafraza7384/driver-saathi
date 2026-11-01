import { Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { db } from "@/lib/backend";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const HomePage = lazyWithRetry(() => import("./pages/HomePage"));
const TransactionsPage = lazyWithRetry(() => import("./pages/TransactionsPage"));
const AddTransactionPage = lazyWithRetry(() => import("./pages/AddTransactionPage"));
const DebtsPage = lazyWithRetry(() => import("./pages/DebtsPage"));
const GoalsPage = lazyWithRetry(() => import("./pages/GoalsPage"));
const HealthPage = lazyWithRetry(() => import("./pages/HealthPage"));
const AssistantPage = lazyWithRetry(() => import("./pages/AssistantPage"));
const MorePage = lazyWithRetry(() => import("./pages/MorePage"));
const CarChecksPage = lazyWithRetry(() => import("./pages/CarChecksPage"));
const RemindersPage = lazyWithRetry(() => import("./pages/RemindersPage"));
const NotesPage = lazyWithRetry(() => import("./pages/NotesPage"));
const SOSPage = lazyWithRetry(() => import("./pages/SOSPage"));
const CarSosPage = lazyWithRetry(() => import("./pages/CarSosPage"));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage"));
const DataBackupPage = lazyWithRetry(() => import("./pages/DataBackupPage"));
const FinanceAIPage = lazyWithRetry(() => import("./pages/FinanceAIPage"));
const PrivacyPolicyPage = lazyWithRetry(() => import("./pages/PrivacyPolicyPage"));
const AuthPage = lazyWithRetry(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const AdminLayout = lazyWithRetry(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazyWithRetry(() => import("./pages/admin/AdminDashboard"));
const AdminPostsPage = lazyWithRetry(() => import("./pages/admin/AdminPostsPage"));
const AdminCategoriesPage = lazyWithRetry(() => import("./pages/admin/AdminCategoriesPage"));
const AdminUsersPage = lazyWithRetry(() => import("./pages/admin/AdminUsersPage"));
const AdminPlansPage = lazyWithRetry(() => import("./pages/admin/AdminPlansPage"));
const AdminOffersPage = lazyWithRetry(() => import("./pages/admin/AdminOffersPage"));
const AdminMechanicsPage = lazyWithRetry(() => import("./pages/admin/AdminMechanicsPage"));
const AdminSosPage = lazyWithRetry(() => import("./pages/admin/AdminSosPage"));
const AdminInsuranceLeadsPage = lazyWithRetry(() => import("./pages/admin/AdminInsuranceLeadsPage"));
const AdminAnnouncementsPage = lazyWithRetry(() => import("./pages/admin/AdminAnnouncementsPage"));
const InsuranceLeadPage = lazyWithRetry(() => import("./pages/InsuranceLeadPage"));
const BudgetsPage = lazyWithRetry(() => import("./pages/BudgetsPage"));

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

/**
 * Full-screen branded loader for app start (auth check, first route
 * chunk). Reuses the #boot markup/CSS that index.html paints before any
 * JS runs, so native splash -> HTML loader -> this -> Home has no flash
 * of white in between.
 */
function BootScreen() {
  return (
    <div id="boot" role="status" aria-label="Loading Driver Saathi">
      <img src="/icon-192.png" alt="" width={96} height={96} />
      <div className="n">Driver Saathi</div>
      <div className="s" />
    </div>
  );
}

function BlockedScreen() {
  const { signOut } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-bold text-destructive">{t("blocked.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("blocked.message")}</p>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => { signOut(); navigate("/auth"); }}
        >
          {t("auth.logout")}
        </button>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Block gate: a profile flagged is_blocked by an admin cannot use the app.
  // Query errors or a missing profile are treated as NOT blocked, so a read
  // failure can never lock a legitimate user out.
  const { data: blockedProfile } = useQuery({
    queryKey: ["blocked_gate", user?.id],
    queryFn: async () => {
      try {
        const { data, error } = await db.from("profiles").select("is_blocked").eq("user_id", user!.id).single();
        if (error) return null;
        return data as { is_blocked?: boolean } | null;
      } catch {
        return null;
      }
    },
    enabled: !!user,
  });

  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  if (loading) return <BootScreen />;

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (blockedProfile?.is_blocked === true) {
    return <BlockedScreen />;
  }

  // Admin pages render without the main app's bottom navigation: the
  // admin panel has its own Back buttons and dashboard links.
  if (location.pathname.startsWith("/admin")) {
    return <Outlet />;
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
              <ErrorBoundary>
              <Suspense fallback={<BootScreen />}>
                <Routes>
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
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
                    <Route path="/car-sos" element={<CarSosPage />} />
                    <Route path="/insurance" element={<InsuranceLeadPage />} />
                    <Route path="/budgets" element={<BudgetsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/data-backup" element={<DataBackupPage />} />
                    <Route path="/finance-ai" element={<FinanceAIPage />} />
                  </Route>
                  <Route element={<ProtectedRoutes />}>
                    <Route element={<AdminLayout />}>
                      <Route path="/admin" element={<AdminDashboard />} />
                      <Route path="/admin/posts" element={<AdminPostsPage />} />
                      <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route path="/admin/plans" element={<AdminPlansPage />} />
                      <Route path="/admin/offers" element={<AdminOffersPage />} />
                      <Route path="/admin/mechanics" element={<AdminMechanicsPage />} />
                      <Route path="/admin/sos" element={<AdminSosPage />} />
                      <Route path="/admin/insurance-leads" element={<AdminInsuranceLeadsPage />} />
                      <Route path="/admin/announcements" element={<AdminAnnouncementsPage />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

