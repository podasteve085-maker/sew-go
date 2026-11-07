import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Filet de sécurité React (class ErrorBoundary) qui intercepte toute exception
 * de rendu dans l'arborescence AppShell / Outlet, notamment les crashs qui
 * surviennent en mode hors-ligne et qui produisaient l'« écran marron ».
 *
 * Sans cette barrière, une exception propagée depuis un composant enfant
 * démont l'intégralité du sous-arbre React → le fond de page (#1c1917)
 * devient visible (l'écran marron que l'utilisateur voyait).
 */
export class OfflineErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[CouturPro] Crash intercepté par OfflineErrorBoundary:", error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // Recharge douce : on tente d'abord une navigation sans rechargement complet
    // pour conserver l'état IndexedDB. Si ça ne suffit pas, on recharge la page.
    try {
      window.history.go(0);
    } catch {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
          <div className="max-w-sm w-full text-center space-y-5">
            <span className="text-5xl" role="img" aria-label="fil et aiguille">
              🧵
            </span>
            <div className="space-y-2">
              <h1 className="font-semibold text-lg text-foreground">
                Atelier momentanément indisponible
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Un problème temporaire est survenu lors du chargement de cette section.
                <br />
                Vos données sont sécurisées et seront synchronisées dès votre reconnexion.
              </p>
            </div>
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-sm active:scale-95 transition-transform"
            >
              Réessayer
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
