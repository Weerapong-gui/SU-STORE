"use client";

import { useEffect } from "react";

export function PreventBackNavigation() {
  useEffect(() => {
    history.pushState(null, "", location.href);
    const handle = () => history.pushState(null, "", location.href);
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, []);

  return null;
}
