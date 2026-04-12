import { useI18n } from "@/lib/i18n";
import { 
  CreditCard, Target, Car, Bell, StickyNote, Shield, 
  Settings, ChevronRight, Sun, Moon, Info, HardDrive, Mail, Phone, MessageCircle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function MorePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const isDark = theme === "dark";

  const menuItems = [
    { labelKey: "more.debtEmi", icon: CreditCard, path: "/debts" },
    { labelKey: "more.goalsSavings", icon: Target, path: "/goals" },
    { labelKey: "more.carChecks", icon: Car, path: "/car-checks" },
    { labelKey: "more.reminders", icon: Bell, path: "/reminders" },
    { labelKey: "more.notes", icon: StickyNote, path: "/notes" },
    { labelKey: "more.emergencySos", icon: Shield, path: "/sos" },
    { labelKey: "more.dataBackup", icon: HardDrive, path: "/data-backup" },
    { labelKey: "more.settings", icon: Settings, path: "/settings" },
  ];

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md px-4 pt-6 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-bold">{t("nav.more")}</h1>
      </div>
      <div className="px-4 space-y-5">
      <div className="space-y-1">
        {menuItems.map((item) => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors hover:bg-muted active:bg-muted/80">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <item.icon className="h-5 w-5 text-foreground" />
              </div>
              <span className="text-base font-bold">{t(item.labelKey)}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        ))}

        {/* Dark Mode Toggle */}
        <div className="flex w-full items-center justify-between rounded-xl p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              {isDark ? <Moon className="h-5 w-5 text-foreground" /> : <Sun className="h-5 w-5 text-foreground" />}
            </div>
            <span className="text-base font-bold">{t("more.darkMode")}</span>
          </div>
          <Switch checked={isDark} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
        </div>

        {/* Contact Us */}
        <button onClick={() => setContactOpen(true)}
          className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors hover:bg-muted active:bg-muted/80">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5 text-foreground" />
            </div>
            <span className="text-base font-bold">Contact Us</span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>

        {/* About */}
        <button onClick={() => setAboutOpen(true)}
          className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors hover:bg-muted active:bg-muted/80">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Info className="h-5 w-5 text-foreground" />
            </div>
            <span className="text-base font-bold">{t("more.about")}</span>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>

      {/* About Dialog */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("more.about")}</DialogTitle>
            <DialogDescription>{t("more.aboutDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("more.appVersion")}</span>
              <span className="font-bold">1.0.0</span>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-bold">{t("more.privacyPolicy")}</h4>
              <Button variant="link" className="p-0 h-auto text-primary text-xs" onClick={() => { setAboutOpen(false); navigate("/privacy-policy"); }}>
                Read Full Privacy Policy →
              </Button>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-bold">{t("more.termsOfUse")}</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">{t("more.termsText")}</p>
            </div>
            <p className="text-center text-xs text-muted-foreground pt-2">© 2026 Driver-saathi. All rights reserved.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact Us Dialog */}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Contact Us</DialogTitle>
            <DialogDescription>We're here to help! Reach out to our support team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <a href="mailto:support@driversaathi.app" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-extrabold">Email Support</p>
                <p className="text-xs text-muted-foreground">support@driversaathi.app</p>
              </div>
            </a>
            <a href="tel:+917718012850" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Phone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-extrabold">Phone Support</p>
                <p className="text-xs text-muted-foreground">+91 7718012850</p>
              </div>
            </a>
            <a href="https://wa.me/917718012850" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-xl border p-4 hover:bg-muted transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-extrabold">WhatsApp</p>
                <p className="text-xs text-muted-foreground">Chat with us on WhatsApp</p>
              </div>
            </a>
            <p className="text-center text-xs text-muted-foreground pt-2">Support hours: Mon–Sat, 9 AM – 6 PM IST</p>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}