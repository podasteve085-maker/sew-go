import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Rotate3d,
  Play,
  Pause,
  Sparkles,
  Move,
} from "lucide-react";
import { StoredImage } from "./bits";

interface CatalogLightboxProps {
  open: boolean;
  onClose: () => void;
  photos: string[];
  initialIndex?: number;
  modelName: string;
  categoryLabel?: string;
  priceFormatted?: string | null;
}

export function CatalogLightbox({
  open,
  onClose,
  photos,
  initialIndex = 0,
  modelName,
  categoryLabel,
  priceFormatted,
}: CatalogLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [is360Mode, setIs360Mode] = useState(false);
  const [isAutoSpinning, setIsAutoSpinning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Pour le drag 360 et le pan
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragAccumulatorRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);
  const initialPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1);
  const autoSpinTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Synchronisation avec l'index initial à l'ouverture
  useEffect(() => {
    if (open) {
      setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, photos.length - 1)));
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setIs360Mode(false);
      setIsAutoSpinning(false);
    }
  }, [open, initialIndex, photos.length]);

  // Réinitialisation du zoom et pan lors du changement d'image
  const resetZoomAndPan = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Gestion de la rotation automatique 360°
  useEffect(() => {
    if (isAutoSpinning && photos.length > 1) {
      autoSpinTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % photos.length);
      }, 700);
    } else {
      if (autoSpinTimerRef.current) {
        clearInterval(autoSpinTimerRef.current);
        autoSpinTimerRef.current = null;
      }
    }
    return () => {
      if (autoSpinTimerRef.current) {
        clearInterval(autoSpinTimerRef.current);
      }
    };
  }, [isAutoSpinning, photos.length]);

  // Clavier pour navigation & fermeture
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === " " && is360Mode) {
        e.preventDefault();
        setIsAutoSpinning((v) => !v);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, photos.length, is360Mode]);

  const handlePrev = useCallback(() => {
    if (photos.length <= 1) return;
    resetZoomAndPan();
    setCurrentIndex((prev) => (prev === 0 ? photos.length - 1 : prev - 1));
  }, [photos.length, resetZoomAndPan]);

  const handleNext = useCallback(() => {
    if (photos.length <= 1) return;
    resetZoomAndPan();
    setCurrentIndex((prev) => (prev === photos.length - 1 ? 0 : prev + 1));
  }, [photos.length, resetZoomAndPan]);

  // Contrôles de zoom
  const zoomIn = () => {
    setZoom((z) => Math.min(3.5, Number((z + 0.5).toFixed(1))));
  };

  const zoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, Number((z - 0.5).toFixed(1)));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  // Double-tap ou double-clic pour zoom rapide 2.2x
  const handleDoubleTap = (clientX: number, clientY: number) => {
    if (is360Mode) return;
    if (zoom > 1) {
      resetZoomAndPan();
    } else {
      setZoom(2.2);
      // Centrer légèrement vers l'endroit cliqué si possible
      const rect = window.innerWidth;
      const offsetX = (window.innerWidth / 2 - clientX) * 0.5;
      const offsetY = (window.innerHeight / 2 - clientY) * 0.5;
      setPan({ x: offsetX, y: offsetY });
    }
  };

  // Gestion des événements tactiles
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Début du pincement (pinch)
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      initialPinchDistRef.current = dist;
      initialPinchZoomRef.current = zoom;
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Double tap détecté
        handleDoubleTap(touch.clientX, touch.clientY);
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;

      setIsDragging(true);
      dragStartRef.current = { x: touch.clientX, y: touch.clientY };
      panStartRef.current = { ...pan };
      dragAccumulatorRef.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistRef.current && !is360Mode) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const scaleDelta = dist / initialPinchDistRef.current;
      const newZoom = Math.min(3.5, Math.max(1, Number((initialPinchZoomRef.current * scaleDelta).toFixed(2))));
      setZoom(newZoom);
      if (newZoom === 1) setPan({ x: 0, y: 0 });
      return;
    }

    if (e.touches.length === 1 && isDragging) {
      const touch = e.touches[0];
      const deltaX = touch.clientX - dragStartRef.current.x;
      const deltaY = touch.clientY - dragStartRef.current.y;

      if (is360Mode && photos.length > 1) {
        // Mode 360° : chaque 35px de déplacement horizontal fait tourner à la photo suivante/précédente
        const step = 35;
        const totalDelta = deltaX - dragAccumulatorRef.current;
        if (Math.abs(totalDelta) >= step) {
          const count = Math.trunc(totalDelta / step);
          dragAccumulatorRef.current += count * step;
          setCurrentIndex((prev) => {
            const next = (prev - count) % photos.length;
            return next < 0 ? next + photos.length : next;
          });
        }
      } else if (zoom > 1) {
        // Déplacement libre (Pan) dans l'image zoomée
        const maxPanX = (window.innerWidth * (zoom - 1)) / 2;
        const maxPanY = (window.innerHeight * (zoom - 1)) / 2;
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, panStartRef.current.x + deltaX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, panStartRef.current.y + deltaY)),
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    initialPinchDistRef.current = null;
    if (!isDragging) return;
    setIsDragging(false);

    // Détection de balayage gauche/droite pour changer de photo si non zoomé et non 360
    if (!is360Mode && zoom === 1 && e.changedTouches.length > 0) {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - dragStartRef.current.x;
      const deltaY = touch.clientY - dragStartRef.current.y;
      if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        if (deltaX < 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
    }
  };

  // Gestion de la souris (desktop drag pour pan ou 360)
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    dragAccumulatorRef.current = 0;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    if (is360Mode && photos.length > 1) {
      const step = 30;
      const totalDelta = deltaX - dragAccumulatorRef.current;
      if (Math.abs(totalDelta) >= step) {
        const count = Math.trunc(totalDelta / step);
        dragAccumulatorRef.current += count * step;
        setCurrentIndex((prev) => {
          const next = (prev - count) % photos.length;
          return next < 0 ? next + photos.length : next;
        });
      }
    } else if (zoom > 1) {
      const maxPanX = (window.innerWidth * (zoom - 1)) / 2;
      const maxPanY = (window.innerHeight * (zoom - 1)) / 2;
      setPan({
        x: Math.max(-maxPanX, Math.min(maxPanX, panStartRef.current.x + deltaX)),
        y: Math.max(-maxPanY, Math.min(maxPanY, panStartRef.current.y + deltaY)),
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!open) return null;

  const currentPhoto = photos[currentIndex] || photos[0];
  const angleLabel =
    photos.length > 1
      ? `${Math.round((currentIndex / photos.length) * 360)}° · Vue ${currentIndex + 1}/${photos.length}`
      : "Vue unique";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visionneuse plein écran : ${modelName}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/98 text-white select-none backdrop-blur-md animate-in fade-in duration-200"
      onMouseUp={handleMouseUp}
    >
      {/* Barre supérieure : Titre, 360°, Zoom & Fermeture */}
      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/70 px-3 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm sm:text-base font-bold text-white truncate max-w-[180px] sm:max-w-md">
                {modelName}
              </h2>
              {categoryLabel && (
                <span className="hidden sm:inline-block rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90">
                  {categoryLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/70">
              {photos.length > 0 && (
                <span>
                  📸 {currentIndex + 1} / {photos.length}
                </span>
              )}
              {priceFormatted && <span className="font-semibold text-primary-foreground">• {priceFormatted}</span>}
            </div>
          </div>
        </div>

        {/* Boutons d'action : 360°, Zoom et Fermeture */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Bouton Mode 360° */}
          <button
            type="button"
            onClick={() => {
              const nextState = !is360Mode;
              setIs360Mode(nextState);
              resetZoomAndPan();
              if (!nextState) setIsAutoSpinning(false);
            }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all shadow-xs ${
              is360Mode
                ? "bg-primary text-primary-foreground ring-2 ring-primary/50 shadow-primary/30"
                : "bg-white/10 text-white hover:bg-white/20 active:scale-95"
            }`}
            title="Activer la rotation 360° interactive"
          >
            <Rotate3d className={`size-4 ${is360Mode ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Vue 360°</span>
            <span className="sm:hidden font-mono text-[10px]">360°</span>
          </button>

          {/* Contrôles de zoom (désactivés en mode 360) */}
          {!is360Mode && (
            <div className="flex items-center rounded-full bg-white/10 p-0.5">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= 1}
                className="flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                title="Zoom arrière"
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                type="button"
                onClick={resetZoomAndPan}
                className="px-1.5 text-[11px] font-mono font-bold text-white/90 hover:text-white"
                title="Réinitialiser le zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= 3.5}
                className="flex size-8 items-center justify-center rounded-full text-white/80 hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-all"
                title="Zoom avant"
              >
                <ZoomIn className="size-4" />
              </button>
            </div>
          )}

          {/* Bouton Fermer */}
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 active:scale-95 transition-all shadow-md ml-1"
            title="Fermer le plein écran (Échap)"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      {/* Zone centrale de visualisation de la confection */}
      <div
        className={`relative flex-1 flex items-center justify-center overflow-hidden touch-none ${
          is360Mode
            ? "cursor-ew-resize"
            : zoom > 1
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-default"
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {currentPhoto ? (
          <div
            className="size-full flex items-center justify-center p-2 sm:p-6 transition-transform duration-75 ease-out"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom})`,
              transformOrigin: "center center",
            }}
            onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
          >
            <StoredImage
              path={currentPhoto}
              alt={`${modelName} - Angle ${currentIndex + 1}`}
              className="max-h-full max-w-full object-contain pointer-events-none select-none drop-shadow-2xl"
            />
          </div>
        ) : (
          <div className="text-center text-white/50 space-y-2">
            <Sparkles className="mx-auto size-12" />
            <p>Aucune photo disponible</p>
          </div>
        )}

        {/* Flèches de navigation latérale (masquées si zoom élevé pour faciliter le pan) */}
        {photos.length > 1 && zoom === 1 && !is360Mode && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 flex size-12 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/90 hover:text-white hover:scale-105 active:scale-95 transition-all shadow-xl backdrop-blur-xs z-10"
              title="Photo précédente (Flèche gauche)"
            >
              <ChevronLeft className="size-7" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex size-12 items-center justify-center rounded-full bg-black/60 text-white/90 hover:bg-black/90 hover:text-white hover:scale-105 active:scale-95 transition-all shadow-xl backdrop-blur-xs z-10"
              title="Photo suivante (Flèche droite)"
            >
              <ChevronRight className="size-7" />
            </button>
          </>
        )}

        {/* Overlay Spécial Mode 360° */}
        {is360Mode && (
          <div className="absolute top-4 inset-x-4 flex flex-col items-center pointer-events-none z-10">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-1.5 border border-primary/50 shadow-lg backdrop-blur-md">
              <Rotate3d className="size-4 text-primary animate-spin" />
              <span className="text-xs font-bold text-white tracking-wide">
                {angleLabel}
              </span>
            </div>
            {photos.length > 1 ? (
              <p className="mt-1.5 text-[11px] font-medium text-white/80 bg-black/60 px-3 py-0.5 rounded-full backdrop-blur-xs">
                👈 Glissez le doigt ou la souris horizontalement pour tourner 👉
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] font-medium text-amber-300 bg-black/70 px-3 py-1 rounded-full border border-amber-500/30">
                💡 Ajoutez des photos de face, profil et dos pour profiter de la rotation 360° complète
              </p>
            )}
          </div>
        )}

        {/* Indication visuelle de zoom & déplacement */}
        {zoom > 1 && (
          <div className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1 text-[11px] font-semibold text-white/90 border border-white/20 shadow-md backdrop-blur-md pointer-events-none z-10">
            <Move className="size-3.5 text-primary" />
            <span>Glissez pour parcourir les détails ({Math.round(zoom * 100)}%)</span>
          </div>
        )}
      </div>

      {/* Barre inférieure : Bandeau de miniatures & Auto-spin 360 */}
      <footer className="relative z-20 shrink-0 border-t border-white/10 bg-black/75 p-2 sm:p-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          {/* Contrôle Auto-spin pour le mode 360 */}
          {is360Mode && photos.length > 1 && (
            <button
              type="button"
              onClick={() => setIsAutoSpinning((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25 active:scale-95 transition-all shadow-xs shrink-0"
              title={isAutoSpinning ? "Arrêter la rotation automatique" : "Lancer la rotation automatique"}
            >
              {isAutoSpinning ? (
                <>
                  <Pause className="size-4 text-amber-400" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="size-4 text-primary" />
                  <span>Rotation auto</span>
                </>
              )}
            </button>
          )}

          {/* Bande de miniatures */}
          <div className="flex-1 flex items-center justify-center gap-2 overflow-x-auto py-1 scrollbar-none">
            {photos.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  resetZoomAndPan();
                  setCurrentIndex(idx);
                }}
                className={`relative size-12 sm:size-14 shrink-0 overflow-hidden rounded-xl border-2 transition-all shadow-md ${
                  idx === currentIndex
                    ? "border-primary ring-2 ring-primary/60 scale-105 opacity-100"
                    : "border-white/20 opacity-60 hover:opacity-100 hover:border-white/50"
                }`}
                title={`Photo ${idx + 1}`}
              >
                <StoredImage path={p} alt={`Miniature ${idx + 1}`} className="size-full object-cover" />
                <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/70 px-1 text-[9px] font-bold text-white">
                  {idx + 1}
                </span>
              </button>
            ))}
          </div>

          {/* Bouton Réinitialiser si zoom actif */}
          {zoom > 1 && (
            <button
              type="button"
              onClick={resetZoomAndPan}
              className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25 active:scale-95 transition-all shadow-xs shrink-0"
            >
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Recentrer</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
