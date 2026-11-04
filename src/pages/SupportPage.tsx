import { appVersionLabel } from "@/lib/appVersion";
import { useI18n } from "@/lib/i18n";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Info, Mail, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SupportPage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="space-y-5 p-4 pt-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Info className="h-5 w-5" /> {t("more.supportAbout")}
        </h1>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-bold">{t("more.contactUs")}</h2>
        <p className="text-sm text-muted-foreground">{t("more.supportDesc")}</p>
        <div className="space-y-3 pt-2">
          <a href="mailto:razakhan.chino@gmail.com" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-extrabold">{t("more.emailSupport")}</p>
              <p className="text-xs text-muted-foreground">razakhan.chino@gmail.com</p>
            </div>
          </a>
          <a href="tel:+917718012850" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-extrabold">{t("more.phoneSupport")}</p>
              <p className="text-xs text-muted-foreground">+91 7718012850</p>
            </div>
          </a>
          <a href="https://wa.me/917718012850" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-extrabold">{t("more.whatsapp")}</p>
              <p className="text-xs text-muted-foreground">{t("more.chatWhatsapp")}</p>
            </div>
          </a>
          <p className="text-center text-xs text-muted-foreground pt-2">{t("more.supportHours")}</p>
        </div>
      </div>

      <div className="space-y-4 text-sm border-t pt-4">
        <h2 className="text-lg font-bold">{t("more.about")}</h2>
        <p className="text-muted-foreground">{t("more.aboutDesc")}</p>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("more.appVersion")}</span>
          <span className="font-bold">{appVersionLabel()}</span>
        </div>
        <div className="border-t pt-3 space-y-2">
          <h4 className="font-bold">{t("more.privacyPolicy")}</h4>
          <Button variant="link" className="p-0 h-auto text-primary text-xs" onClick={() => navigate("/privacy-policy")}>
            {t("more.readFullPrivacy")}
          </Button>
        </div>
        <div className="border-t pt-3 space-y-2">
          <h4 className="font-bold">{t("more.termsOfUse")}</h4>
          <p className="text-muted-foreground text-xs leading-relaxed">{t("more.termsText")}</p>
        </div>
        <p className="text-center text-xs text-muted-foreground pt-2">{t("more.copyright")}</p>
      </div>
    </div>
  );
}
