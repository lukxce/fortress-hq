import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fortress HQ — advertising and analytics operations",
  description:
    "Fortress HQ reads Google Ads, Analytics, Search Console and Tag Manager for the advertising accounts Digitl manages, and turns it into daily pacing, alerts and briefings.",
};

// Public landing. Two jobs: describe the application clearly enough for Google's
// brand verification ("the relevance of your home page to the app under review
// must be clear"), and get the operator to the sign-in. Never gated.
export default function Landing() {
  return (
    <div className="shell">
      <div className="sheet sheet-pad rise landing">
        <Link href="/" className="wordmark big">Fortress<span>hq</span></Link>

        <h1>Advertising operations, read every morning.</h1>

        <p className="lede">
          Fortress HQ is the operations platform{" "}
          <a href="https://digitl.me">Digitl</a> uses to run the advertising
          accounts in its care. Every day it reads what those accounts did,
          checks that measurement is still working, and turns the result into
          pacing, alerts and a briefing the team acts on.
        </p>

        <h2>What it does</h2>
        <ul>
          <li><strong>Budget pacing.</strong> Month-to-date spend against plan for every account, with a projection of where the month lands.</li>
          <li><strong>Measurement checks.</strong> Advertising conversions compared against analytics, so a broken tag is told apart from a genuine drop in demand.</li>
          <li><strong>Alerts.</strong> Spend without conversions, disapproved ads, sudden cost changes, and overnight edits to a tag container.</li>
          <li><strong>Search overlap.</strong> Queries being paid for that the site already ranks well on organically.</li>
          <li><strong>Reporting.</strong> The monthly performance report delivered to the account owner.</li>
        </ul>

        <p>
          Changes to an advertising account are only ever applied after a member
          of the team reviews and confirms them.
        </p>

        <hr className="rule" />

        <h2>Access and data</h2>
        <p>
          Fortress HQ connects to Google Ads, Google Analytics, Search Console
          and Tag Manager. It reaches only the accounts whose owners have
          explicitly granted access through Google&rsquo;s own permission
          screens, and that access can be withdrawn at any time without our
          involvement.
        </p>
        <p>
          How that data is accessed, used, stored and deleted is set out in full
          in the <Link href="/privacy.html">privacy policy</Link>.
        </p>

        <div className="landing-cta">
          <Link href="/overview" className="btn btn-primary">Sign in</Link>
          <span className="meta">Operated by Digitl · Niš, Serbia</span>
        </div>
      </div>
    </div>
  );
}
