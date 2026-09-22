import { useEffect, useState, useCallback } from "react";
import { Sun, Moon, Laptop, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "couturpro_theme";

/**
 * Règle d'or du mode "Auto" :
 * - De 06h00 à 18h30 : il fait JOUR dans l'atelier -> Mode CLAIR ☀️
 * - De 18h30 à 06h00 : il fait NUIT -> Mode SOMBRE 🌙 pour reposer les yeux
 *
 * Évite les faux positifs des navigateurs mobiles (comme Safari en navigation privée
 * ou iPhone en mode économie d'énergie qui forcent prefers-color-scheme: dark en plein midi).
 */
export function isAutoDark(): boolean {
  if (typeof window === "undefined") return false;

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  // En plein jour : 06h00 -> 18h30
  const isDaytime = currentHour >= 6 && currentHour < 18.5;

  if (isDaytime) {
    return false; // Jour = Clair garanti
  }

  return true; // Nuit = Sombre
}

export function resolveIsDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return isAutoDark();
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const isDark = resolveIsDark(theme);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Lire la préférence sauvegardée
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark" || saved === "system") {
      setThemeState(saved);
      applyTheme(saved);
    } else {
      applyTheme("system");
    }
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // ignore
    }

    applyTheme(newTheme);
  }, []);

  // Cycle rapide 1-clic : Clair -> Sombre -> Auto
  const cycleTheme = useCallback(() => {
    if (theme === "light") {
      setTheme("dark");
      toast.info("Thème Sombre activé");
    } else if (theme === "dark") {
      setTheme("system");
      const isNight = isAutoDark();
      toast.info(`Thème Auto activé (${isNight ? "Nuit : Sombre" : "Jour : Clair"})`);
    } else {
      setTheme("light");
      toast.info("Thème Clair activé");
    }
  }, [theme, setTheme]);

  // Surveiller le cycle horaire toutes les minutes si en mode Auto
  useEffect(() => {
    applyTheme(theme);

    if (theme === "system") {
      const interval = setInterval(() => {
        applyTheme("system");
      }, 60000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [theme]);

  const isDark = resolveIsDark(theme);

  return { theme, setTheme, cycleTheme, isDark };
}

/** Bouton sélecteur avec Menu Déroulant (Desktop ou Mobile) */
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
          className={`size-8.5 p-0 rounded-xl border-border/80 bg-card hover:bg-muted cursor-pointer shrink-0 shadow-2xs active:scale-95 transition-all ${className ?? ""}`}
          aria-label="Changer le thème"
          title={`Thème actuel : ${
            theme === "dark"
              ? "Sombre (Nuit)"
              : theme === "light"
              ? "Clair (Jour)"
              : isAutoDark()
              ? "Auto (Nuit : Sombre)"
              : "Auto (Jour : Clair)"
          }`}
        >
          {theme === "light" && <Sun className="size-4 text-amber-500" />}
          {theme === "dark" && <Moon className="size-4 text-sky-400" />}
          {theme === "system" && (
            <span className="relative flex items-center justify-center">
              {isAutoDark() ? (
                <Moon className="size-3.5 text-sky-400" />
              ) : (
                <Sun className="size-3.5 text-amber-500" />
              )}
              <span className="absolute -bottom-1 -right-1 text-[8px] font-black text-primary leading-none">
                A
              </span>
            </span>
          )}
          <span className="sr-only">Basculer le thème</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48 rounded-xl p-1.5 shadow-xl border-border bg-card">
        <DropdownMenuItem
          onClick={() => {
            setTheme("light");
            toast.success("Thème Clair activé");
          }}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sun className="size-4 text-amber-500" /> Clair (Atelier)
          </span>
          {theme === "light" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme("dark");
            toast.success("Thème Sombre activé");
          }}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Moon className="size-4 text-sky-400" /> Sombre (Nuit)
          </span>
          {theme === "dark" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setTheme("system");
            const isNight = isAutoDark();
            toast.info(`Thème Automatique (${isNight ? "Nuit : Sombre" : "Jour : Clair"})`);
          }}
          className="flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Laptop className="size-4 text-primary" /> Auto (Jour/Nuit)
          </span>
          {theme === "system" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Variateur segmenté en 3 boutons pour le tiroir mobile ou les paramètres */
export function ThemeSegmentedControl({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={`grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1 border border-border/80 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
          theme === "light"
            ? "bg-card text-foreground shadow-xs border border-border/50"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Sun className="size-3.5 text-amber-500" /> Clair
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
          theme === "dark"
            ? "bg-card text-foreground shadow-xs border border-border/50"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Moon className="size-3.5 text-sky-400" /> Sombre
      </button>
      <button
        type="button"
        onClick={() => setTheme("system")}
        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
          theme === "system"
            ? "bg-card text-foreground shadow-xs border border-border/50"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Laptop className="size-3.5 text-primary" /> Auto
      </button>
    </div>
  );
}
