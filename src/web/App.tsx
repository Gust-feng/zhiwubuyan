import { useSyncExternalStore } from "react";
import { Home, Scale, User as UserIcon } from "lucide-react";
import { SidebarNavRow } from "@ui/personal-workbench/workbench/app/components/SidebarRows";
import { BrandMark } from "@ui/components/brand-mark";
import { VoicesPage } from "@ui/personal-workbench/workbench/app/components/VoicesPage";
import { MinePage } from "@ui/personal-workbench/workbench/app/components/MinePage";
import { consumeZhihuLoginReturnToMine } from "@ui/workbench/zhihu-auth-navigation";
import { HomePage } from "./pages/HomePage";

type WebView = "home" | "voices" | "mine";

type Route = {
  view: WebView;
  query: string;
};

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path = "", queryString = ""] = raw.split("?");
  const restoredView = raw === "" && consumeZhihuLoginReturnToMine() ? "mine" : undefined;
  const view = restoredView ?? (["home", "voices", "mine"] as const).find((v) => v === path) ?? "home";
  const query = new URLSearchParams(queryString).get("q") ?? "";
  return { view, query };
}

let lastHash: string | null = null;
let lastRoute: Route = { view: "home", query: "" };

function getSnapshot(): Route {
  const hash = window.location.hash;
  if (hash !== lastHash) {
    lastHash = hash;
    lastRoute = parseHash();
  }
  return lastRoute;
}

function useHashRoute(): [Route, (view: WebView, query?: string) => void] {
  const route = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    },
    getSnapshot,
  );
  const navigate = (view: WebView, query?: string) => {
    window.location.hash = query ? `/${view}?q=${encodeURIComponent(query)}` : `/${view}`;
  };
  return [route, navigate];
}

export function App() {
  const [route, navigate] = useHashRoute();
  const askQuestion = (question: string) => navigate("voices", question);

  return (
    <div className="web-shell">
      <aside className="web-sidebar">
        <div className="web-sidebar__brand">
          <span className="web-sidebar__brand-mark" aria-hidden="true">
            <BrandMark size={22} />
          </span>
          <span className="web-sidebar__brand-copy">
            知无不言
            <small>知乎问题，摊开来看</small>
          </span>
        </div>
        <nav className="web-sidebar__nav">
          <SidebarNavRow active={route.view === "home"} onClick={() => navigate("home")} labelsVisible collapsed={false} icon={<Home size={14} />} label="首页" />
          <SidebarNavRow active={route.view === "mine"} onClick={() => navigate("mine")} labelsVisible collapsed={false} icon={<UserIcon size={14} />} label="我的知乎" />
          <SidebarNavRow active={route.view === "voices"} onClick={() => navigate("voices")} labelsVisible collapsed={false} icon={<Scale size={14} />} label="众声" />
        </nav>
        <div className="web-sidebar__foot">
          内容来自知乎开放平台；摘要用于浏览，重要判断请回原文核对。
        </div>
      </aside>
      <main className="web-main">
        {route.view === "home" && <HomePage onAskQuestion={askQuestion} />}
        {route.view === "voices" && <VoicesPage key={route.query} initialQuestion={route.query || undefined} />}
        {route.view === "mine" && <MinePage onExit={() => navigate("home")} />}
      </main>
    </div>
  );
}
