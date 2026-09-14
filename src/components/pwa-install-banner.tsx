/**
 * PwaInstallBanner — Composant de prompt d'installation PWA
 *
 * Détecte l'événement `beforeinstallprompt` du navigateur (Chrome/Edge/Android)
 * et expose un bouton d'installation discret. Sur iOS (Safari), affiche
 * une instruction contextuelle "Ajouter à l'écran d'accueil".
 */
import { useEffect, useState } from "react";
import { Download, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallState = "hidden" | "installable" | "ios" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePwaInstall() {
  const [state, setState] = useState<InstallState>("hidden");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Vérifier si déjà installée en mode standalone (sur Android/desktop)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (isStandalone) return; // Déjà installée → ne rien afficher

    // Vérifier si l'utilisateur a déjà refusé dans cette session
    const dismissed = sessionStorage.getItem("pwa-install-dismissed");
    if (dismissed) return;

    // Détection iOS (Safari ne supporte pas beforeinstallprompt)
    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !("MSStream" in window);
    if (isIos) {
      setState("ios");
      return;
    }

    // Détection navigateurs compatibles (Chrome, Edge, Samsung Internet, Opera)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState("installable");
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setState("hidden");
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    sessionStorage.setItem("pwa-install-dismissed", "1");
    setState("dismissed");
  };

  return { state, install, dismiss };
}

/** Bannière compacte affichée dans la barre latérale ou en bas sur mobile */
export function PwaInstallButton({ className }: { className?: string }) {
  const { state, install, dismiss } = usePwaInstall();

  if (state === "hidden" || state === "dismissed") return null;

  if (state === "installable") {
    return (
      <div
        className={`relative flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 ${className ?? ""}`}
      >
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-2 top-2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="size-3.5" />
        </button>
        <p className="pr-5 text-xs font-semibold leading-tight text-foreground">
          📲 Installer CouturPro
        </p>
        <p className="text-xs leading-snug text-muted-foreground">
          Accès rapide sur votre écran d'accueil — fonctionne hors ligne.
        </p>
        <Button size="sm" onClick={install} className="mt-1 h-8 text-xs">
          <Download className="mr-1.5 size-3.5" />
          Installer l'application
        </Button>
      </div>
    );
  }

  if (state === "ios") {
    return (
      <div
        className={`relative flex flex-col gap-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3 ${className ?? ""}`}
      >
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-2 top-2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="size-3.5" />
        </button>
        <p className="pr-5 text-xs font-semibold leading-tight text-foreground">
          📲 Installer CouturPro
        </p>
        <p className="text-xs leading-snug text-muted-foreground">
          Appuyez sur <Info className="inline size-3" /> puis{" "}
          <strong>« Sur l'écran d'accueil »</strong> dans Safari.
        </p>
      </div>
    );
  }

  return null;
}
