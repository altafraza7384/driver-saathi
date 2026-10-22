import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db, BACKEND } from "@/lib/backend";
import { confirmFirebasePasswordReset } from "@/integrations/firebase/adapter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { formatAuthError } from "@/hooks/useAuthActions";
import { useI18n } from "@/lib/i18n";

// Handles both: requesting a reset email, and setting a new password after clicking the emailed link.
export default function ResetPasswordPage() {
  const [recovery, setRecovery] = useState(() => {
    if (typeof window === "undefined") return false;
    if (BACKEND === "firebase") {
      const params = new URLSearchParams(window.location.search);
      return params.get("mode") === "resetPassword" && !!params.get("oobCode");
    }
    return window.location.hash.includes("type=recovery");
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    if (BACKEND === "firebase") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "resetPassword" && params.get("oobCode")) {
        setRecovery(true);
      }
      return;
    }
    const { data } = db.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      toast({ title: "Could not send link", description: formatAuthError(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: t("auth.passwordsMismatch"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      if (BACKEND === "firebase") {
        const oobCode = new URLSearchParams(window.location.search).get("oobCode");
        if (!oobCode) throw new Error(t("auth.invalidResetLink"));
        await confirmFirebasePasswordReset(oobCode, password);
        toast({ title: t("auth.passwordUpdated"), description: t("auth.signInNewPassword") });
        navigate("/auth", { replace: true });
      } else {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        toast({ title: t("auth.passwordUpdated"), description: t("auth.signedInNow") });
        navigate("/", { replace: true });
      }
    } catch (error) {
      toast({ title: t("auth.couldNotUpdate"), description: formatAuthError(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{recovery ? t("auth.setNewPassword") : t("auth.forgotPassword")}</CardTitle>
          <CardDescription>
            {recovery
              ? t("auth.enterNewPassword")
              : t("auth.resetDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recovery ? (
            <form onSubmit={updatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("auth.newPassword")}</Label>
                <Input id="new-password" type="password" minLength={6} required autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t("auth.confirmPassword")}</Label>
                <Input id="confirm-password" type="password" minLength={6} required autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("common.saving") : t("auth.updatePassword")}
              </Button>
            </form>
          ) : sent ? (
            <p className="text-sm text-muted-foreground">
              {t("auth.resetSent", { email })}
            </p>
          ) : (
            <form onSubmit={sendLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">{t("auth.email")}</Label>
                <Input id="reset-email" type="email" inputMode="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.sending") : t("auth.sendResetLink")}
              </Button>
            </form>
          )}
          <div className="mt-4 text-center text-sm">
            <Link to="/auth" className="font-medium text-primary hover:underline">{t("auth.backToLogin")}</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
