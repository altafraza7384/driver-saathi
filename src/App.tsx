import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { db } from "@/lib/backend";
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
const CarSosPage = lazy(() => import("./pages/CarSosPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const DataBackupPage = lazy(() => import("./pages/DataBackupPage"));
const FinanceAIPage = lazy(() => import("./pages/FinanceAIPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminPostsPage = lazy(() => import("./pages/admin/AdminPostsPage"));
const AdminCategoriesPage = lazy(() => import("./pages/admin/AdminCategoriesPage"));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage"));
const AdminPlansPage = lazy(() => import("./pages/admin/AdminPlansPage"));
const AdminOffersPage = lazy(() => import("./pages/admin/AdminOffersPage"));
const AdminMechanicsPage = lazy(() => import("./pages/admin/AdminMechanicsPage"));
const AdminSosPage = lazy(() => import("./pages/admin/AdminSosPage"));
const AdminInsuranceLeadsPage = lazy(() => import("./pages/admin/AdminInsuranceLeadsPage"));
const InsuranceLeadPage = lazy(() => import("./pages/InsuranceLeadPage"));

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

function BlockedScreen() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-bold text-destructive">{"Account Blocked"}</h1>
        <p className="text-sm text-muted-foreground">{"Your account has been blocked by the admin. Please contact support if you think this is a mistake."}</p>
        <button
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          onClick={() => { signOut(); navigate("/auth"); }}
        >
          {"Log out"}
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

  if (loading) return <RouteLoader />;

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
              <Suspense fallback={<RouteLoader />}>
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

