import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { LoginWindowApp } from "./features/auth/login-window";
import { ErrorBoundary } from "./components/error-boundary";
import { applyMotionPreference } from "./shell/motion";
import { applyTheme, getInitialTheme } from "./shell/theme";
import { workbenchQueryClient } from "./query-client";
import "./personal-workbench/workbench/styles/index.css";

applyMotionPreference();
const initialTheme = getInitialTheme();
// The inline bootstrap script paints the first frame; applying the same
// preference here also installs the live OS listener for "跟随系统".
applyTheme(initialTheme.styleId, initialTheme.colorId);

// /login 是桌面端独立登录窗口的入口；网页端登录走应用内弹窗，不设这条路由。
// 编译期用量：网页产物里这个分支恒为 false，不会被误用为登录页。
const isLoginWindow = __WORKBENCH_SURFACE__ !== "web"
  && window.location.pathname.replace(/\/+$/, "") === "/login";

createRoot(document.getElementById("root")!).render(
  <>
    <ErrorBoundary>
      <QueryClientProvider client={workbenchQueryClient}>
        {isLoginWindow ? <LoginWindowApp /> : <App />}
      </QueryClientProvider>
    </ErrorBoundary>
  </>
);
