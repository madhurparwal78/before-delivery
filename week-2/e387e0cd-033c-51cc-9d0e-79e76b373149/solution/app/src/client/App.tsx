// Every published route, public and staff, mapped to its screen.
import type { JSX } from "preact";
import { usePlace } from "./router";
import type { Role } from "./types";
import { MissingPage, RoleRefused, StaffShell, useDesk } from "./staff/desk";
import { HomePage } from "./public/Home";
import { JurisdictionPage } from "./public/JurisdictionPage";
import { ExchangePage } from "./public/ExchangePage";
import { RequestPage } from "./public/RequestPage";
import { SignInPage } from "./public/SignIn";
import { NotFoundPage } from "./public/NotFound";
import { CasesScreen } from "./staff/Cases";
import { CaseScreen } from "./staff/CasePage";
import { ReviewScreen } from "./staff/Review";
import { MessageScreen, MessagesScreen } from "./staff/Messages";
import { CounterpartiesScreen, CounterpartyScreen, ImportScreen } from "./staff/Counterparties";
import { JurisdictionRulesScreen, RulesScreen } from "./staff/Rules";
import { DailyReportScreen } from "./staff/DailyReport";
import { MonthScreen, MonthsScreen } from "./staff/Months";
import { FilesScreen } from "./staff/Files";
import { PartnerKeysScreen } from "./staff/PartnerKeys";
import { MembersScreen } from "./staff/Members";
import { ListingScreen } from "./staff/Listing";

const OFFICER: Role = "compliance_officer";
const ANALYST: Role = "compliance_analyst";
const OPS: Role = "operations_lead";
const FINANCE: Role = "finance_lead";
const SUPPORT: Role = "support_agent";
const EVERYONE: Role[] = [OFFICER, ANALYST, OPS, FINANCE, SUPPORT];

interface StaffRoute {
  pattern: RegExp;
  title: string;
  roles: Role[];
  screen: (m: RegExpExecArray) => JSX.Element;
}

const STAFF_ROUTES: StaffRoute[] = [
  { pattern: /^cases$/, title: "Withdrawals", roles: EVERYONE, screen: () => <CasesScreen /> },
  { pattern: /^cases\/([^/]+)$/, title: "Case", roles: EVERYONE, screen: (m) => <CaseScreen id={m[1]} /> },
  { pattern: /^review$/, title: "Review queue", roles: [OFFICER, ANALYST, SUPPORT], screen: () => <ReviewScreen /> },
  { pattern: /^messages$/, title: "Incoming messages", roles: [OFFICER, ANALYST, OPS, SUPPORT], screen: () => <MessagesScreen /> },
  { pattern: /^messages\/([^/]+)$/, title: "Message", roles: [OFFICER, ANALYST, OPS, SUPPORT], screen: (m) => <MessageScreen id={m[1]} /> },
  { pattern: /^counterparties$/, title: "Counterparties", roles: EVERYONE, screen: () => <CounterpartiesScreen /> },
  { pattern: /^counterparties\/import$/, title: "Import counterparties", roles: [OFFICER, ANALYST], screen: () => <ImportScreen /> },
  { pattern: /^counterparties\/([^/]+)$/, title: "Counterparty", roles: EVERYONE, screen: (m) => <CounterpartyScreen id={m[1]} /> },
  { pattern: /^rules$/, title: "Rules", roles: EVERYONE, screen: () => <RulesScreen /> },
  { pattern: /^rules\/([^/]+)$/, title: "Rules", roles: EVERYONE, screen: (m) => <JurisdictionRulesScreen code={m[1]} /> },
  { pattern: /^reports\/daily$/, title: "Daily report", roles: [OFFICER, ANALYST], screen: () => <DailyReportScreen /> },
  { pattern: /^months$/, title: "Months", roles: [OFFICER, FINANCE], screen: () => <MonthsScreen /> },
  { pattern: /^months\/(\d{4}-\d{2})$/, title: "Month", roles: [OFFICER, FINANCE], screen: (m) => <MonthScreen month={m[1]} /> },
  { pattern: /^files$/, title: "Regulator's monthly files", roles: [OFFICER, ANALYST, SUPPORT], screen: () => <FilesScreen /> },
  { pattern: /^partner-keys$/, title: "Partner keys", roles: [OFFICER], screen: () => <PartnerKeysScreen /> },
  { pattern: /^members$/, title: "Members", roles: [OFFICER], screen: () => <MembersScreen /> },
  { pattern: /^listing$/, title: "Directory listing", roles: [OFFICER], screen: () => <ListingScreen /> },
];

function StaffScreen({ route, match }: { route: StaffRoute; match: RegExpExecArray }) {
  const desk = useDesk();
  return route.roles.includes(desk.role) ? route.screen(match) : <RoleRefused title={route.title} />;
}

export function App() {
  const { path } = usePlace();
  const staff = /^\/w\/([^/]+)\/(.+?)\/?$/.exec(path);
  if (staff) {
    for (const route of STAFF_ROUTES) {
      const match = route.pattern.exec(staff[2]);
      if (match) {
        return (
          <StaffShell slug={staff[1]}>
            <StaffScreen key={path} route={route} match={match} />
          </StaffShell>
        );
      }
    }
    return <MissingPage />;
  }
  if (path === "/") return <HomePage />;
  if (path === "/sign-in") return <SignInPage />;
  const jurisdiction = /^\/jurisdictions\/([^/]+)$/.exec(path);
  if (jurisdiction) return <JurisdictionPage key={path} code={decodeURIComponent(jurisdiction[1])} />;
  const exchange = /^\/exchanges\/([^/]+)$/.exec(path);
  if (exchange) return <ExchangePage key={path} slug={decodeURIComponent(exchange[1])} />;
  const request = /^\/r\/([^/]+)$/.exec(path);
  if (request) return <RequestPage token={request[1]} />;
  return <NotFoundPage />;
}
