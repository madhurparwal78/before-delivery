/** Marketing entry: every public page loads this bundle, and each module acts only when its markup is present. */
import { initBillingPeriod } from "../marketing/billing-period";
import { initEmailCapture } from "../marketing/email-capture";
import { initHeaderMenus } from "../marketing/header-menus";
import { initInquiryForm } from "../marketing/inquiry-form";
import { initNarrowMenu } from "../marketing/narrow-menu";
import { initScrollReveal } from "../marketing/scroll-reveal";
import { initTranscript } from "../marketing/transcript";

initHeaderMenus();
initNarrowMenu();
initEmailCapture();
initTranscript();
initScrollReveal();
initBillingPeriod();
initInquiryForm();
