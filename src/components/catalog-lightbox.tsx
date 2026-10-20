import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Rotate3d,
  Play,
  Pause,
  ArrowLeft,
  Scissors,
  Coins,
  Share2,
  MessageCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { StoredImage } from "./bits";

/* ── Types ──────────────────────────────────────────────────────── */

export interface LightboxModel {
  id: string;
  name: string;
  photo_paths: string[];
  category: string;
  default_price?: number | null;
  fabric_needed?: string | null;
  description?: string | null;
}

interface CatalogLightboxProps {
  open: boolean;
  onClose: () => void;
  /** Tous les modèles visibles dans le catalogue (pour naviguer entre eux) */
  models: LightboxModel[];
  /** Index du modèle actuellement sélectionné dans la liste `models` */
  initialModelIndex?: number;
  /** Index de la photo dans le modèle sélectionné */
  initialPhotoIndex?: number;
  /** Libellé de catégorie */
  categoryLabel?: (cat: string) => string;
  /** Formatteur de prix */
  formatPrice?: (price: number) => string;
  /** Actions optionnelles */
  onOrder?: (model: LightboxModel) => void;
  onShare?: (model: LightboxModel) => void;
  onEdit?: (model: LightboxModel) => void;
}

/* ── Composant ──────────────────────────────────────────────────── */

export function CatalogLightbox({
  open,
  onClose,
  models,
  initialModelIndex = 0,
  initialPhotoIndex = 0,
  categoryLabel,
  formatPrice,
  onOrder,
  onShare,
  onEdit,
}: CatalogLightboxProps) {
  const [modelIndex, setModelIndex] = useState(initialModelIndex);
  const [photoIndex, setPhotoIndex] = useState(initialPhotoIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [is360, setIs360] = useState(false);
  const [autoSpin, setAutoSpin] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const drag360Ref = useRef(0);
  const lastTapRef = useRef(0);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const model = models[modelIndex] ?? null;
  const photos = model?.photo_paths ?? [];
  const currentPhoto = photos[photoIndex] ?? null;

  /* ── Synchronisation à l'ouverture ────────────────────────────── */
  useEffect(() => {
    if (open) {
      setModelIndex(Math.min(Math.max(0, initialModelIndex), Math.max(0, models.length - 1)));
      setPhotoIndex(Math.min(Math.max(0, initialPhotoIndex), Math.max(0, (models[initialModelIndex]?.photo_paths?.length ?? 1) - 1)));
      resetView();
    }
  }, [open, initialModelIndex, initialPhotoIndex, models.length]);

  /* ── Blocage du scroll body en plein écran ────────────────────── */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIs360(false);
    setAutoSpin(false);
    setShowInfo(false);
  }, []);

  /* ── Auto-spin 360° ───────────────────────────────────────────── */
  useEffect(() => {
    if (autoSpin && photos.length > 1) {
      autoTimerRef.current = setInterval(() => {
        setPhotoIndex((prev) => (prev + 1) % photos.length);
      }, 600);
    } else if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoSpin, photos.length]);

  /* ── Navigation clavier ───────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prevPhoto();
      else if (e.key === "ArrowRight") nextPhoto();
      else if (e.key === "ArrowUp") prevModel();
      else if (e.key === "ArrowDown") nextModel();
      else if (e.key === " " && is360) { e.preventDefault(); setAutoSpin((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, photos.length, models.length, is360]);

  /* ── Navigation photos ────────────────────────────────────────── */
  const prevPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setPhotoIndex((p) => (p === 0 ? photos.length - 1 : p - 1));
  }, [photos.length]);

  const nextPhoto = useCallback(() => {
    if (photos.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setPhotoIndex((p) => (p === photos.length - 1 ? 0 : p + 1));
  }, [photos.length]);

  /* ── Navigation entre modèles du catalogue ────────────────────── */
  const prevModel = useCallback(() => {
    if (models.length <= 1) return;
    resetView();
    setModelIndex((i) => (i === 0 ? models.length - 1 : i - 1));
    setPhotoIndex(0);
  }, [models.length, resetView]);

  const nextModel = useCallback(() => {
    if (models.length <= 1) return;
    resetView();
    setModelIndex((i) => (i === models.length - 1 ? 0 : i + 1));
    setPhotoIndex(0);
  }, [models.length, resetView]);

  /* ── Zoom ──────────────────────────────────────────────────────── */
  const zoomIn = () => setZoom((z) => Math.min(3.5, +(z + 0.5).toFixed(1)));
  const zoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.5).toFixed(1));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleDoubleTap = (cx: number, cy: number) => {
    if (is360) return;
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
    else {
      setZoom(2.2);
      setPan({
        x: (window.innerWidth / 2 - cx) * 0.5,
        y: (window.innerHeight / 2 - cy) * 0.5,
      });
    }
  };

  /* ── Gestes tactiles ──────────────────────────────────────────── */
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchDistRef.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      pinchZoomRef.current = zoom;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        handleDoubleTap(t.clientX, t.clientY);
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
      setIsDragging(true);
      dragStartRef.current = { x: t.clientX, y: t.clientY };
      panStartRef.current = { ...pan };
      drag360Ref.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistRef.current && !is360) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const newZ = Math.min(3.5, Math.max(1, +(pinchZoomRef.current * dist / pinchDistRef.current).toFixed(2)));
      setZoom(newZ);
      if (newZ === 1) setPan({ x: 0, y: 0 });
      return;
    }
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      if (is360 && photos.length > 1) {
        const step = 35;
        const delta = dx - drag360Ref.current;
        if (Math.abs(delta) >= step) {
          const count = Math.trunc(delta / step);
          drag360Ref.current += count * step;
          setPhotoIndex((p) => { const n = (p - count) % photos.length; return n < 0 ? n + photos.length : n; });
        }
      } else if (zoom > 1) {
        const maxX = (window.innerWidth * (zoom - 1)) / 2;
        const maxY = (window.innerHeight * (zoom - 1)) / 2;
        setPan({
          x: Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx)),
          y: Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy)),
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    pinchDistRef.current = null;
    if (!isDragging) return;
    setIsDragging(false);
    if (!is360 && zoom === 1 && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > 50 && absDx > absDy * 1.3) {
        // Swipe horizontal : photo précédente/suivante
        dx < 0 ? nextPhoto() : prevPhoto();
      } else if (absDy > 60 && absDy > absDx * 1.3) {
        // Swipe vertical : modèle précédent/suivant
        dy < 0 ? nextModel() : prevModel();
      }
    }
  };

  /* ── Gestes souris (desktop) ──────────────────────────────────── */
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    drag360Ref.current = 0;
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (is360 && photos.length > 1) {
      const step = 30;
      const delta = dx - drag360Ref.current;
      if (Math.abs(delta) >= step) {
        const count = Math.trunc(delta / step);
        drag360Ref.current += count * step;
        setPhotoIndex((p) => { const n = (p - count) % photos.length; return n < 0 ? n + photos.length : n; });
      }
    } else if (zoom > 1) {
      const maxX = (window.innerWidth * (zoom - 1)) / 2;
      const maxY = (window.innerHeight * (zoom - 1)) / 2;
      setPan({
        x: Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy)),
      });
    }
  };
  const handleMouseUp = () => setIsDragging(false);

  if (!open || !model) return null;

  const catLabel = categoryLabel ? categoryLabel(model.category) : model.category;
  const priceStr = model.default_price && formatPrice ? formatPrice(model.default_price) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plein écran : ${model.name}`}
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white select-none animate-in fade-in duration-150"
      onMouseUp={handleMouseUp}
    >
      {/* ── Zone photo plein écran (bord-à-bord, zéro bande noire) ─── */}
      <div
        className={`relative flex-1 flex items-center justify-center overflow-hidden touch-none ${
          is360 ? "cursor-ew-resize" : zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onClick={() => { if (zoom === 1 && !is360) setShowInfo((v) => !v); }}
      >
        {/* ── Fond d'ambiance flouté dynamique (élimine 100% des bandes noires) ─── */}
        {currentPhoto && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
            <StoredImage
              path={currentPhoto}
              alt="fond d'ambiance"
              className="size-full object-cover blur-3xl scale-125 opacity-35 brightness-75 transition-all duration-300"
            />
          </div>
        )}

        {currentPhoto ? (
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-75 ease-out"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: "center center",
            }}
            onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
          >
            <StoredImage
              path={currentPhoto}
              alt={`${model.name} - vue ${photoIndex + 1}`}
              className={`size-full ${fitMode === "cover" ? "object-cover" : "object-contain"} pointer-events-none drop-shadow-2xl transition-all duration-200`}
            />
          </div>
        ) : (
          <div className="text-center text-white/50 space-y-3 z-10">
            <Scissors className="mx-auto size-16 stroke-[1]" />
            <p className="text-sm font-medium">Aucune photo pour ce modèle</p>
          </div>
        )}

        {/* ── Bouton retour (toujours visible, haut-gauche) ─────────── */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-[env(safe-area-inset-top,12px)] left-3 z-20 flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md pl-2.5 pr-3.5 py-2 text-sm font-bold text-white hover:bg-black/70 active:scale-95 transition-all shadow-lg"
          title="Retour au catalogue"
        >
          <ArrowLeft className="size-5" />
          <span className="hidden sm:inline text-xs">Retour</span>
        </button>

        {/* ── Contrôles haut-droite : Remplir/Adapter + Compteurs ───── */}
        <div className="absolute top-[env(safe-area-inset-top,12px)] right-3 z-20 flex items-center gap-1.5">
          {/* Bouton Remplir / Adapter l'écran */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFitMode((m) => (m === "cover" ? "contain" : "cover"));
            }}
            className="rounded-full bg-black/50 backdrop-blur-md px-2.5 py-1 text-[11px] font-bold text-white hover:bg-black/70 active:scale-95 transition-all shadow-md flex items-center gap-1"
            title={fitMode === "cover" ? "Afficher le modèle entier (Adapter)" : "Remplir tout l'écran du téléphone (Plein écran)"}
          >
            {fitMode === "cover" ? <Minimize2 className="size-3 text-primary" /> : <Maximize2 className="size-3 text-primary" />}
            <span className="hidden min-[360px]:inline">{fitMode === "cover" ? "Adapter" : "Remplir"}</span>
          </button>

          {photos.length > 1 && (
            <span className="rounded-full bg-black/50 backdrop-blur-md px-2.5 py-1 text-[11px] font-bold shadow-md">
              📸 {photoIndex + 1}/{photos.length}
            </span>
          )}
          {models.length > 1 && (
            <span className="rounded-full bg-primary/80 backdrop-blur-md px-2.5 py-1 text-[11px] font-bold shadow-md">
              {modelIndex + 1}/{models.length}
            </span>
          )}
        </div>

        {/* ── Flèches de navigation photos (gauche/droite) ──────────── */}
        {photos.length > 1 && zoom === 1 && !is360 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prevPhoto(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/40 text-white/90 hover:bg-black/70 active:scale-90 transition-all shadow-lg backdrop-blur-xs"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); nextPhoto(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/40 text-white/90 hover:bg-black/70 active:scale-90 transition-all shadow-lg backdrop-blur-xs"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}

        {/* ── Flèches navigation modèles (haut/bas) ─────────────────── */}
        {models.length > 1 && zoom === 1 && !is360 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prevModel(); }}
              className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex size-9 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/70 active:scale-90 transition-all shadow-md backdrop-blur-xs"
              title="Modèle précédent"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); nextModel(); }}
              className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex size-9 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/70 active:scale-90 transition-all shadow-md backdrop-blur-xs"
              title="Modèle suivant"
            >
              <ChevronDown className="size-5" />
            </button>
          </>
        )}

        {/* ── Indicateur Mode 360° ──────────────────────────────────── */}
        {is360 && (
          <div className="absolute top-16 inset-x-4 flex flex-col items-center pointer-events-none z-10">
            <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 border border-primary/40 shadow-lg backdrop-blur-md">
              <Rotate3d className="size-4 text-primary animate-spin" />
              <span className="text-xs font-bold tracking-wide">
                {photos.length > 1
                  ? `${Math.round((photoIndex / photos.length) * 360)}° · Vue ${photoIndex + 1}/${photos.length}`
                  : "Vue unique"}
              </span>
            </div>
            <p className="mt-1.5 text-[10px] font-medium text-white/70 bg-black/50 px-3 py-0.5 rounded-full backdrop-blur-xs">
              {photos.length > 1
                ? "👈 Glissez horizontalement pour tourner 👉"
                : "💡 Ajoutez des photos sous plusieurs angles"}
            </p>
          </div>
        )}

        {/* ── Indicateur de zoom actif ──────────────────────────────── */}
        {zoom > 1 && (
          <div className="absolute bottom-20 left-4 z-10 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white/90 shadow-md backdrop-blur-md pointer-events-none">
            🔍 {Math.round(zoom * 100)}% — Glissez pour parcourir
          </div>
        )}
      </div>

      {/* ── Barre inférieure compacte ────────────────────────────────── */}
      <div className="shrink-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent pb-[env(safe-area-inset-bottom,8px)]">
        {/* Infos modèle (visible quand showInfo ou toujours compact) */}
        <div className={`px-4 transition-all duration-200 overflow-hidden ${showInfo ? "max-h-40 opacity-100 py-2" : "max-h-12 opacity-100 py-1.5"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm text-white truncate">{model.name}</h3>
              <div className="flex items-center gap-2 text-[11px] text-white/70 mt-0.5">
                <span className="bg-white/15 rounded px-1.5 py-0.5 font-medium">{catLabel}</span>
                {priceStr && <span className="font-bold text-primary">{priceStr}</span>}
                {model.fabric_needed && <span className="truncate">🧵 {model.fabric_needed}</span>}
              </div>
            </div>
            {/* Boutons d'action compacts */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* 360° */}
              <button
                type="button"
                onClick={() => { setIs360((v) => !v); setZoom(1); setPan({ x: 0, y: 0 }); if (is360) setAutoSpin(false); }}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                  is360
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "bg-white/15 text-white hover:bg-white/25"
                }`}
                title="Mode 360°"
              >
                <Rotate3d className={`size-3.5 ${is360 ? "animate-spin" : ""}`} />
                <span className="hidden min-[380px]:inline">360°</span>
              </button>
              {/* Auto-spin */}
              {is360 && photos.length > 1 && (
                <button
                  type="button"
                  onClick={() => setAutoSpin((v) => !v)}
                  className="flex size-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 active:scale-90"
                  title={autoSpin ? "Pause" : "Rotation auto"}
                >
                  {autoSpin ? <Pause className="size-3.5 text-amber-400" /> : <Play className="size-3.5" />}
                </button>
              )}
              {/* Zoom */}
              {!is360 && (
                <div className="flex items-center rounded-full bg-white/15 p-0.5">
                  <button type="button" onClick={zoomOut} disabled={zoom <= 1}
                    className="flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none">
                    <ZoomOut className="size-3.5" />
                  </button>
                  <span className="px-1 text-[10px] font-mono font-bold text-white/90">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={zoomIn} disabled={zoom >= 3.5}
                    className="flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none">
                    <ZoomIn className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Détails étendus (quand showInfo est activé) */}
          {showInfo && (
            <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              {model.description && (
                <p className="text-[11px] text-white/70 line-clamp-2 leading-relaxed">{model.description}</p>
              )}
              <div className="flex items-center gap-2">
                {onOrder && (
                  <button
                    type="button"
                    onClick={() => onOrder(model)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground shadow-md active:scale-95"
                  >
                    <Scissors className="size-3.5" /> Commander
                  </button>
                )}
                {onShare && (
                  <button
                    type="button"
                    onClick={() => onShare(model)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2 text-xs font-bold text-white shadow-md active:scale-95"
                  >
                    <MessageCircle className="size-3.5" /> WhatsApp
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bandeau de miniatures (photos du modèle actuel) */}
        {photos.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto px-3 pb-1.5 pt-0.5 scrollbar-none">
            {photos.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setPhotoIndex(i); }}
                className={`relative size-11 shrink-0 overflow-hidden rounded-lg border-2 transition-all shadow-md ${
                  i === photoIndex
                    ? "border-primary ring-2 ring-primary/50 scale-110 opacity-100"
                    : "border-white/20 opacity-50 hover:opacity-90"
                }`}
              >
                <StoredImage path={p} alt={`${i + 1}`} className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
