import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function TermsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md px-4 pt-6 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/more")} className="p-2 -ml-2 rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">{t("more.termsConditions")}</h1>
        </div>
      </div>
      <div className="px-4 pb-8 text-sm text-foreground space-y-4">
        <p className="text-xs text-muted-foreground">Last updated: November 7, 2026</p>
        <p>These Terms and Conditions ("Terms") govern your use of Driver-saathi ("the Service", "the App"). By creating an account or using the Service, you agree to these Terms. If you do not agree, please do not use the Service.</p>

        <h2 className="text-lg font-bold mt-6">The Service</h2>
        <p>Driver-saathi helps drivers track trips and earnings, manage budgets and reminders, request roadside help through Car SOS, and use AI features (AI Assistant and Finance AI). Some features are free; AI features require a subscription or a free trial (see "Subscriptions and Payments" below).</p>

        <h2 className="text-lg font-bold mt-6">Accounts</h2>
        <p>You are responsible for keeping your account credentials safe and for all activity under your account. You may delete your account from within the App; deleting your account removes your data as described in our Privacy Policy.</p>

        <h2 className="text-lg font-bold mt-6">Subscriptions and Payments</h2>
        <p>AI features are available on a paid subscription with a 7-day free trial:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Monthly: ₹99 per month (MRP ₹199)</li>
          <li>Yearly: ₹999 per year (MRP ₹1188)</li>
        </ul>
        <p>To start a subscription you approve a UPI autopay mandate. A one-time ₹1 verification charge is taken when the mandate is set up; it is non-refundable. The plan amount is auto-debited only after the 7-day trial ends. Your subscription becomes active only once the mandate is active. You can cancel before the trial ends and no plan amount will be charged. Payments are processed by Razorpay; all prices are in Indian Rupees (INR) and include applicable taxes.</p>

        <h2 className="text-lg font-bold mt-6">AI Features</h2>
        <p>The AI Assistant and Finance AI answer questions and help with money planning. AI replies are guidance only — they are not professional financial, legal, or tax advice. Usage limits apply (trial, paid, and free tiers have different hourly limits). Your AI chat history is stored only on your own device, not on our servers.</p>

        <h2 className="text-lg font-bold mt-6">Car SOS</h2>
        <p>Car SOS connects you with nearby mechanics for car problems, battery issues, towing, and other help. We do not guarantee that a mechanic will accept your request, arrive within any particular time, or be able to fix the problem. Car SOS is not a replacement for emergency services — for accidents or danger, call the police or an ambulance first. Your phone number and exact location are shared only with the mechanic assigned to your request.</p>

        <h2 className="text-lg font-bold mt-6">Insurance Leads</h2>
        <p>If you submit a car insurance enquiry, your details are shared with a licensed insurance partner so they can contact you with a quote. We do not sell insurance ourselves.</p>

        <h2 className="text-lg font-bold mt-6">Acceptable Use</h2>
        <p>You agree not to misuse the Service, break the law, or try to access other users' accounts or data. We may suspend or close accounts that violate these Terms.</p>

        <h2 className="text-lg font-bold mt-6">Limitation of Liability</h2>
        <p>The Service is provided "as is". To the extent permitted by law, we are not liable for any loss arising from SOS delays or non-acceptance, AI guidance, third-party services (including payment and mapping providers), or interruptions to the Service.</p>

        <h2 className="text-lg font-bold mt-6">Changes to These Terms</h2>
        <p>We may update these Terms from time to time. Changes are effective when posted on this page. Continued use of the Service after a change means you accept the updated Terms.</p>

        <h2 className="text-lg font-bold mt-6">Contact Us</h2>
        <p>If you have any questions about these Terms:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Email: <a href="mailto:razakhan.chino@gmail.com" className="text-primary underline">razakhan.chino@gmail.com</a></li>
          <li>Phone: <a href="tel:+917718012850" className="text-primary underline">+91 7718012850</a></li>
        </ul>

        <p className="text-center text-xs text-muted-foreground mt-8">© 2026 Driver-saathi. All rights reserved.</p>
      </div>
    </div>
  );
}
