import { useEffect, useState } from "react";
import { Sun, Moon, Laptop, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "couturpro_theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Lire la préférence sauvegardée
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark" || saved === "system") {
      setThemeState(saved);
    }
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }

    applyTheme(newTheme);
  };

  useEffect(() => {
    applyTheme(theme);

    if (theme === "system" && typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme("system");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    }
    // eslint-disable-next-line consistent-return
    return undefined;
  }, [theme]);

  return { theme, setTheme };
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function ThemeToggle({
  className,
  align = "end",
}: {
  className?: string;
  align?: "start" | "end" | "center";
}) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`size-9 p-0 rounded-xl border-border/70 hover:bg-muted cursor-pointer shrink-0 shadow-2xs ${className ?? ""}`}
          aria-label="Changer le thème"
          title={`Thème actuel : ${theme === "dark" ? "Sombre" : theme === "light" ? "Clair" : "Automatique"}`}
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-sky-400" />
          <span className="sr-only">Basculer le thème</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-40 rounded-xl p-1.5 shadow-lg border-border">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sun className="size-4 text-amber-500" /> Clair
          </span>
          {theme === "light" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Moon className="size-4 text-sky-400" /> Sombre / Noir
          </span>
          {theme === "dark" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Laptop className="size-4 text-muted-foreground" /> Automatique
          </span>
          {theme === "system" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Variateur segmenté en 3 boutons pour les paramètres de l'atelier ou le tiroir mobile */
export function ThemeSegmentedControl() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1 border border-border/70">
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
          theme === "light"
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Sun className="size-3.5 text-amber-500" /> Clair
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
          theme === "dark"
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Moon className="size-3.5 text-sky-400" /> Sombre
      </button>
      <button
        type="button"
        onClick={() => setTheme("system")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all cursor-pointer ${
          theme === "system"
            ? "bg-card text-foreground shadow-xs"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Laptop className="size-3.5 text-muted-foreground" /> Auto
      </button>
    </div>
  );
}
