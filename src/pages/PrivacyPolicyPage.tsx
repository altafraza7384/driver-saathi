import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md px-4 pt-6 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/more")} className="p-2 -ml-2 rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold">{t("more.privacyPolicy")}</h1>
        </div>
      </div>
      <div className="px-4 pb-8 text-sm text-foreground space-y-4">
        <p className="text-xs text-muted-foreground">Last updated: April 12, 2026</p>
        <p>This Privacy Policy describes Our policies and procedures on the collection, use and disclosure of Your information when You use the Service and tells You about Your privacy rights and how the law protects You.</p>
        <p>We use Your Personal Data to provide and improve the Service. By using the Service, You agree to the collection and use of information in accordance with this Privacy Policy.</p>

        <h2 className="text-lg font-bold mt-6">Interpretation and Definitions</h2>
        <h3 className="text-base font-semibold">Interpretation</h3>
        <p>The words whose initial letters are capitalized have meanings defined under the following conditions.</p>

        <h3 className="text-base font-semibold">Definitions</h3>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Account</strong> – a unique account created for You to access our Service.</li>
          <li><strong>Application</strong> – Driver-saathi, the software program provided by the Company.</li>
          <li><strong>Company</strong> – Driver-saathi (also referred to as "We", "Us" or "Our").</li>
          <li><strong>Country</strong> – Maharashtra, India.</li>
          <li><strong>Device</strong> – any device that can access the Service.</li>
          <li><strong>Personal Data</strong> – any information that relates to an identified or identifiable individual.</li>
          <li><strong>Service</strong> – the Application.</li>
          <li><strong>Service Provider</strong> – any person who processes data on behalf of the Company.</li>
          <li><strong>Usage Data</strong> – data collected automatically from the Service.</li>
          <li><strong>You</strong> – the individual accessing or using the Service.</li>
        </ul>

        <h2 className="text-lg font-bold mt-6">Collecting and Using Your Personal Data</h2>
        <h3 className="text-base font-semibold">Personal Data</h3>
        <p>We may ask You to provide personally identifiable information including:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Email address</li>
          <li>First name and last name</li>
          <li>Phone number</li>
          <li>Address, State, Province, ZIP/Postal code, City</li>
        </ul>

        <h3 className="text-base font-semibold">Usage Data</h3>
        <p>Usage Data may include Your Device's IP address, browser type, pages visited, time and date of visit, unique device identifiers and other diagnostic data.</p>

        <h3 className="text-base font-semibold">Information Collected while Using the Application</h3>
        <p>We may collect, with Your prior permission:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Information regarding your location</li>
          <li>Information from your Device's phone book</li>
          <li>Pictures and information from your Device's camera and photo library</li>
        </ul>

        <h3 className="text-base font-semibold mt-4">Use of Your Personal Data</h3>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>To provide and maintain our Service</strong></li>
          <li><strong>To manage Your Account</strong></li>
          <li><strong>For the performance of a contract</strong></li>
          <li><strong>To contact You</strong> by email, telephone, SMS, or push notifications</li>
          <li><strong>To provide You</strong> with news, offers, and general information</li>
          <li><strong>To manage Your requests</strong></li>
          <li><strong>For business transfers</strong></li>
          <li><strong>For other purposes</strong> such as data analysis and service improvement</li>
        </ul>

        <h3 className="text-base font-semibold mt-4">Retention of Your Personal Data</h3>
        <p>We retain Your Personal Data only for as long as necessary. Retention periods:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>User Accounts: duration of account + up to 24 months after closure</li>
          <li>Support tickets: up to 24 months from closure</li>
          <li>Chat transcripts: up to 24 months</li>
          <li>Usage statistics & server logs: up to 24 months</li>
        </ul>

        <h3 className="text-base font-semibold mt-4">Transfer of Your Personal Data</h3>
        <p>Your information may be transferred to and maintained on computers located outside of Your jurisdiction. We ensure appropriate safeguards are in place.</p>

        <h3 className="text-base font-semibold mt-4">Delete Your Personal Data</h3>
        <p>You have the right to delete or request deletion of Personal Data. You may update or delete Your information by signing in to Your Account.</p>

        <h3 className="text-base font-semibold mt-4">Disclosure of Your Personal Data</h3>
        <p>We may disclose Your Personal Data:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>In business transactions (merger, acquisition, asset sale)</li>
          <li>If required by law enforcement</li>
          <li>To comply with legal obligations</li>
          <li>To protect rights, property, or safety</li>
          <li>To protect against legal liability</li>
        </ul>

        <h3 className="text-base font-semibold mt-4">Security of Your Personal Data</h3>
        <p>While We strive to use commercially reasonable means to protect Your Personal Data, no method of transmission over the Internet is 100% secure.</p>

        <h2 className="text-lg font-bold mt-6">Children's Privacy</h2>
        <p>Our Service does not address anyone under the age of 16. We do not knowingly collect information from anyone under 16.</p>

        <h2 className="text-lg font-bold mt-6">Links to Other Websites</h2>
        <p>Our Service may contain links to third-party websites. We have no control over their content or privacy policies.</p>

        <h2 className="text-lg font-bold mt-6">Changes to this Privacy Policy</h2>
        <p>We may update this Privacy Policy from time to time. Changes are effective when posted on this page.</p>

        <h2 className="text-lg font-bold mt-6">Contact Us</h2>
        <p>If you have any questions about this Privacy Policy:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Email: <a href="mailto:razakhan.chino@gmail.com" className="text-primary underline">razakhan.chino@gmail.com</a></li>
          <li>Phone: <a href="tel:+917718012850" className="text-primary underline">+91 7718012850</a></li>
        </ul>

        <p className="text-center text-xs text-muted-foreground mt-8">© 2026 Driver-saathi. All rights reserved.</p>
      </div>
    </div>
  );
}
