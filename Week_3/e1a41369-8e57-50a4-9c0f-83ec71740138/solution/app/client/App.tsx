import { Shell } from "./components/Shell";
import { Board } from "./pages/Board";
import { ImportHistory } from "./pages/ImportHistory";
import { Landing } from "./pages/Landing";
import { QuestDetail } from "./pages/QuestDetail";
import { QuestHistory } from "./pages/QuestHistory";
import { Settings } from "./pages/Settings";
import { Signin } from "./pages/Signin";
import { usePath } from "./router";

const QUEST_PREFIX = "/quests/";

export function App() {
  const path = usePath();
  if (path === "/") return <Landing />;
  if (path === "/signin") return <Signin />;
  return (
    <Shell>
      {path === "/board" ? (
        <Board />
      ) : path === "/settings" ? (
        <Settings />
      ) : path === "/imports" ? (
        <ImportHistory />
      ) : path === "/history" ? (
        <QuestHistory />
      ) : (
        <QuestDetail questId={path.slice(QUEST_PREFIX.length)} />
      )}
    </Shell>
  );
}
