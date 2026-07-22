"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/lib/theme-provider";
import { ConfirmDialogProvider } from "@/components/ConfirmDialog";
import { FavoritesProvider } from "@/lib/use-favorites";
import PreferencesSync from "@/components/PreferencesSync";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ConfirmDialogProvider>
          <FavoritesProvider>
            <PreferencesSync />
            {children}
          </FavoritesProvider>
        </ConfirmDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
