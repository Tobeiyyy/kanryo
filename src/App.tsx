import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UnauthorizedError } from "./api";
import { applyTheme, getThemePref } from "./theme";
import Nav from "./components/Nav";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import Project from "./pages/Project";
import Settings from "./pages/Settings";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof UnauthorizedError && location.pathname !== "/login") {
        location.href = "/login";
      }
    },
  }),
});

function Layout() {
  const { pathname } = useLocation();
  // Recovery pass for gcal failures, once per app load (spec: Section 4 recovery).
  useEffect(() => {
    if (pathname !== "/login") {
      void fetch("/api/gcal/sync", { method: "POST" }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (pathname === "/login") return <Login />;
  return (
    <>
      <Nav />
      <main className="shell">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/project/:id" element={<Project />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  useEffect(() => applyTheme(getThemePref()), []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Layout />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
