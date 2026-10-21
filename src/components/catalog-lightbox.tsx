import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Rotate3d,
  Play,
  Pause,
  ArrowLeft,
  Scissors,
  Share2,
  MessageCircle,
  Maximize2,
  Minimize2,
  LayoutGrid,
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
  /** Tous les modèles du catalogue pour naviguer entre eux */
  models: LightboxModel[];
  /** Index du modèle actif */
  initialModelIndex?: number;
  /** Index de la photo active */
  initialPhotoIndex?: number;
  /** Libellé de la catégorie */
  categoryLabel?: (cat: string) => string;
  /** Formatteur de prix */
  formatPrice?: (price: number) => string;
  /** Actions */
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
}: CatalogLightboxProps) {
  const [modelIndex, setModelIndex] = useState(initialModelIndex);
  const [photoIndex, setPhotoIndex] = useState(initialPhotoIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [is360, setIs360] = useState(false);
  const [angle360, setAngle360] = useState(0);
  const [autoSpin, setAutoSpin] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const angleStartRef = useRef(0);
  const lastTapRef = useRef(0);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);
  const autoSpinRef = useRef<number | null>(null);

  const model = models[modelIndex] ?? null;
  const photos = model?.photo_paths ?? [];
  const currentPhoto = photos[photoIndex] ?? null;

  /* ── Synchronisation à l'ouverture ────────────────────────────── */
  useEffect(() => {
    if (open) {
      setModelIndex(Math.min(Math.max(0, initialModelIndex), Math.max(0, models.length - 1)));
      setPhotoIndex(Math.min(Math.max(0, initialPhotoIndex), Math.max(0, (models[initialModelIndex]?.photo_paths?.length ?? 1) - 1)));
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setIs360(false);
      setAngle360(0);
      setAutoSpin(false);
      setShowModelPicker(false);
    }
  }, [open, initialModelIndex, initialPhotoIndex, models.length]);

  /* ── Blocage du scroll de la page ─────────────────────────────── */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  /* ── Moteur Rotation 360° (Animation fluide à 60fps) ───────────── */
  useEffect(() => {
    if (!open || !is360 || !autoSpin) {
      if (autoSpinRef.current) cancelAnimationFrame(autoSpinRef.current);
      return;
    }

    let lastTime = performance.now();
    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      // Rotation de 45° par seconde
      setAngle360((prev) => {
        const next = (prev + (dt * 0.045)) % 360;
        if (photos.length > 1) {
          const idx = Math.floor((next / 360) * photos.length) % photos.length;
          setPhotoIndex(idx);
        }
        return next;
      });
      autoSpinRef.current = requestAnimationFrame(animate);
    };

    autoSpinRef.current = requestAnimationFrame(animate);
    return () => {
      if (autoSpinRef.current) cancelAnimationFrame(autoSpinRef.current);
    };
  }, [open, is360, autoSpin, photos.length]);

  /* ── Navigation Clavier ───────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prevPhoto();
      else if (e.key === "ArrowRight") nextPhoto();
      else if (e.key === "ArrowUp") prevModel();
      else if (e.key === "ArrowDown") nextModel();
      else if (e.key === " " && is360) {
        e.preventDefault();
        setAutoSpin((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, photos.length, models.length, is360]);

  /* ── Navigation Photos du modèle ──────────────────────────────── */
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

  /* ── Navigation Modèles du catalogue ──────────────────────────── */
  const prevModel = useCallback(() => {
    if (models.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setIs360(false); setAutoSpin(false); setAngle360(0);
    setModelIndex((i) => (i === 0 ? models.length - 1 : i - 1));
    setPhotoIndex(0);
  }, [models.length]);

  const nextModel = useCallback(() => {
    if (models.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setIs360(false); setAutoSpin(false); setAngle360(0);
    setModelIndex((i) => (i === models.length - 1 ? 0 : i + 1));
    setPhotoIndex(0);
  }, [models.length]);

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
    if (zoom > 1) {
      setZoom(1); setPan({ x: 0, y: 0 });
    } else {
      setZoom(2.2);
      setPan({
        x: (window.innerWidth / 2 - cx) * 0.5,
        y: (window.innerHeight / 2 - cy) * 0.5,
      });
    }
  };

  /* ── Gestes Tactiles ──────────────────────────────────────────── */
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
      angleStartRef.current = angle360;
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

      if (is360) {
        // Mode 360 : glisser horizontalement fait tourner le modèle de 0° à 360°
        setAutoSpin(false);
        const newAngle = ((angleStartRef.current - dx * 0.75) % 360 + 360) % 360;
        setAngle360(newAngle);
        if (photos.length > 1) {
          const idx = Math.floor((newAngle / 360) * photos.length) % photos.length;
          setPhotoIndex(idx);
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

      if (absDx > 45 && absDx > absDy * 1.3) {
        // Swipe horizontal : photo suivante/précédente
        dx < 0 ? nextPhoto() : prevPhoto();
      } else if (absDy > 60 && absDy > absDx * 1.3) {
        // Swipe vertical : modèle suivant/précédent
        dy < 0 ? nextModel() : prevModel();
      }
    }
  };

  /* ── Gestes Souris (Desktop) ──────────────────────────────────── */
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    angleStartRef.current = angle360;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (is360) {
      setAutoSpin(false);
      const newAngle = ((angleStartRef.current - dx * 0.75) % 360 + 360) % 360;
      setAngle360(newAngle);
      if (photos.length > 1) {
        const idx = Math.floor((newAngle / 360) * photos.length) % photos.length;
        setPhotoIndex(idx);
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

  // Calcul de la perspective 3D si une seule photo
  const perspective3D = photos.length <= 1 && is360
    ? `perspective(1000px) rotateY(${Math.sin((angle360 * Math.PI) / 180) * 32}deg)`
    : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plein écran : ${model.name}`}
      className="fixed inset-0 z-[120] flex flex-col bg-black text-white select-none animate-in fade-in duration-150"
      onMouseUp={handleMouseUp}
    >
      {/* ══════════════════════════════════════════════════════════════════
          1. BARRE DE NAVIGATION SUPÉRIEURE (ULTRA-VISIBLE AVEC RETOUR PROMINENT)
         ══════════════════════════════════════════════════════════════════ */}
      <header className="relative z-50 shrink-0 border-b border-white/15 bg-neutral-950/95 px-3 py-2.5 sm:px-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          {/* BOUTON RETOUR IM-MAN-QUA-BLE */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs sm:text-sm font-black text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-all border border-primary/40 shrink-0"
            title="Revenir au catalogue et aux filtres"
          >
            <ArrowLeft className="size-4.5 stroke-[2.5]" />
            <span>Retour Catalogue</span>
          </button>

          {/* SÉLECTEUR RAPIDE DE MODÈLE (Slalom) */}
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={prevModel}
              disabled={models.length <= 1}
              className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
              title="Modèle précédent (Flèche haut)"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-center px-1 truncate max-w-[140px] sm:max-w-xs">
              <p className="text-xs sm:text-sm font-bold text-white truncate">{model.name}</p>
              <p className="text-[10px] text-white/60 font-semibold truncate">
                Modèle {modelIndex + 1}/{models.length} · {catLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={nextModel}
              disabled={models.length <= 1}
              className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
              title="Modèle suivant (Flèche bas)"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* ACTIONS HAUT-DROITE : LISTE MODÈLES, REMPLIR, FERMER */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Bouton pour ouvrir la grille de tous les modèles */}
            <button
              type="button"
              onClick={() => setShowModelPicker((v) => !v)}
              className={`flex items-center gap-1 rounded-xl px-2.5 py-2 text-xs font-bold transition-all shadow-xs ${
                showModelPicker
                  ? "bg-primary text-primary-foreground"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              title="Voir tous les modèles du catalogue"
            >
              <LayoutGrid className="size-3.5" />
              <span className="hidden sm:inline">Tous</span>
            </button>

            {/* Bouton Remplir / Adapter */}
            <button
              type="button"
              onClick={() => setFitMode((m) => (m === "cover" ? "contain" : "cover"))}
              className="flex items-center gap-1 rounded-xl bg-white/10 px-2.5 py-2 text-xs font-bold text-white hover:bg-white/20 active:scale-95"
              title={fitMode === "cover" ? "Adapter le vêtement complet" : "Remplir tout l'écran"}
            >
              {fitMode === "cover" ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span className="hidden sm:inline">{fitMode === "cover" ? "Adapter" : "Remplir"}</span>
            </button>

            {/* Bouton Quitter (X) */}
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-xl bg-destructive/80 text-white hover:bg-destructive active:scale-95 transition-all shadow-md ml-0.5"
              title="Fermer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          2. ZONE PHOTO CENTRALE (Bord-à-bord, Fond Ambiant, Zéro Bande Noire)
         ══════════════════════════════════════════════════════════════════ */}
      <div
        className={`relative flex-1 flex items-center justify-center overflow-hidden touch-none ${
          is360 ? "cursor-ew-resize" : zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {/* Fond d'ambiance flouté dynamique (élimine 100% des bandes noires) */}
        {currentPhoto && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
            <StoredImage
              path={currentPhoto}
              alt="fond d'ambiance"
              className="size-full object-cover blur-3xl scale-125 opacity-40 brightness-75 transition-all duration-300"
            />
          </div>
        )}

        {/* Image du vêtement avec zoom / pan / 360 3D */}
        {currentPhoto ? (
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-75 ease-out"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) ${perspective3D}`,
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

        {/* Flèches Photos Suivante / Précédente (gauche/droite) */}
        {photos.length > 1 && zoom === 1 && !is360 && (
          <>
            <button
              type="button"
              onClick={prevPhoto}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 active:scale-90 transition-all shadow-xl backdrop-blur-xs border border-white/20"
              title="Photo précédente"
            >
              <ChevronLeft className="size-6.5" />
            </button>
            <button
              type="button"
              onClick={nextPhoto}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 flex size-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 active:scale-90 transition-all shadow-xl backdrop-blur-xs border border-white/20"
              title="Photo suivante"
            >
              <ChevronRight className="size-6.5" />
            </button>
          </>
        )}

        {/* Indicateur de Mode 360° en haut au centre de l'image */}
        {is360 && (
          <div className="absolute top-3 inset-x-4 flex flex-col items-center pointer-events-none z-30">
            <div className="flex items-center gap-2 rounded-full bg-black/85 px-4 py-1.5 border border-primary/50 shadow-2xl backdrop-blur-md">
              <Rotate3d className="size-4 text-primary animate-spin" />
              <span className="text-xs font-black text-white tracking-wider">
                ROTATION 360° : {Math.round(angle360)}° {photos.length > 1 ? `· Vue ${photoIndex + 1}/${photos.length}` : "· 3D"}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-bold text-white/90 bg-black/70 px-3 py-0.5 rounded-full backdrop-blur-xs">
              👈 Glissez le doigt horizontalement pour pivoter 👉
            </p>
          </div>
        )}

        {/* Indicateur de Zoom en bas à gauche */}
        {zoom > 1 && (
          <div className="absolute bottom-4 left-4 z-20 rounded-full bg-black/75 px-3 py-1 text-[11px] font-bold text-white border border-white/20 shadow-md backdrop-blur-md pointer-events-none">
            🔍 {Math.round(zoom * 100)}% — Glissez pour parcourir
          </div>
        )}

        {/* DRAWER SUR ÉCRAN : GRILLE DES AUTRES MODÈLES DU CATALOGUE */}
        {showModelPicker && (
          <div className="absolute inset-x-3 bottom-3 top-3 z-40 flex flex-col rounded-2xl bg-neutral-950/95 p-3.5 border border-white/20 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <LayoutGrid className="size-4 text-primary" />
                <h4 className="font-bold text-xs sm:text-sm text-white">
                  Tous les modèles du catalogue ({models.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowModelPicker(false)}
                className="flex size-7 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-2.5">
              {models.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setModelIndex(idx);
                    setPhotoIndex(0);
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    setIs360(false);
                    setShowModelPicker(false);
                  }}
                  className={`group flex flex-col text-left overflow-hidden rounded-xl border-2 transition-all p-1 ${
                    idx === modelIndex
                      ? "border-primary bg-primary/20 ring-2 ring-primary/40"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-black/40">
                    {m.photo_paths?.[0] ? (
                      <StoredImage path={m.photo_paths[0]} alt={m.name} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-white/40">
                        <Scissors className="size-6" />
                      </div>
                    )}
                    <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] font-bold">
                      #{idx + 1}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-white truncate px-0.5">{m.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          3. BARRE INFÉRIEURE : CONTRÔLE 360°, ZOOM, MINIATURES & ACTIONS
         ══════════════════════════════════════════════════════════════════ */}
      <footer className="relative z-50 shrink-0 border-t border-white/15 bg-neutral-950/95 px-3 py-2 sm:px-4 backdrop-blur-md pb-[max(env(safe-area-inset-bottom),8px)]">
        {/* BANDEAU DE COMMANDE 360° SI LE MODE 360 EST ACTIF */}
        {is360 ? (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setAutoSpin((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black shadow-md transition-all ${
                  autoSpin ? "bg-amber-500 text-black" : "bg-primary text-primary-foreground"
                }`}
              >
                {autoSpin ? <Pause className="size-3.5 fill-black" /> : <Play className="size-3.5 fill-current" />}
                <span>{autoSpin ? "Pause" : "Auto-Rotation 360°"}</span>
              </button>

              <div className="flex-1 flex items-center gap-2 max-w-md">
                <span className="text-[10px] font-mono font-bold text-white/70">0°</span>
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={Math.round(angle360)}
                  onChange={(e) => {
                    setAutoSpin(false);
                    const val = Number(e.target.value);
                    setAngle360(val);
                    if (photos.length > 1) {
                      const idx = Math.floor((val / 360) * photos.length) % photos.length;
                      setPhotoIndex(idx);
                    }
                  }}
                  className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <span className="text-[10px] font-mono font-bold text-white/70">360°</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIs360(false);
                  setAutoSpin(false);
                  setAngle360(0);
                }}
                className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-white/25"
              >
                Quitter 360°
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* LIGNE INFO ET CONTRÔLES */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-white truncate">{model.name}</h3>
                  {priceStr && <span className="font-black text-xs text-primary">{priceStr}</span>}
                </div>
                {model.fabric_needed && (
                  <p className="text-[10px] text-white/70 truncate">🧵 {model.fabric_needed}</p>
                )}
              </div>

              {/* BOUTONS D'ACTION : 360°, ZOOM, COMMANDER */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* BOUTON MODE 360° (DÉMARRE DIRECTEMENT LA ROTATION) */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !is360;
                    setIs360(next);
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    if (next) {
                      setAutoSpin(true); // Démarrage immédiat de la rotation !
                    } else {
                      setAutoSpin(false);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-primary px-3 py-1.5 text-xs font-black text-black shadow-lg hover:scale-105 active:scale-95 transition-all"
                  title="Faire tourner le modèle à 360°"
                >
                  <Rotate3d className="size-4 animate-spin stroke-[2.5]" />
                  <span>Mode 360°</span>
                </button>

                {/* ZOOM */}
                <div className="flex items-center rounded-xl bg-white/15 p-0.5">
                  <button
                    type="button"
                    onClick={zoomOut}
                    disabled={zoom <= 1}
                    className="flex size-7 items-center justify-center rounded-lg text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ZoomOut className="size-3.5" />
                  </button>
                  <span className="px-1 text-[10px] font-mono font-bold text-white/90">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={zoomIn}
                    disabled={zoom >= 3.5}
                    className="flex size-7 items-center justify-center rounded-lg text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ZoomIn className="size-3.5" />
                  </button>
                </div>

                {/* COMMANDER WHATSAPP */}
                {onOrder && (
                  <button
                    type="button"
                    onClick={() => onOrder(model)}
                    className="flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground shadow-sm active:scale-95"
                  >
                    <Scissors className="size-3.5" />
                    <span className="hidden sm:inline">Commander</span>
                  </button>
                )}
                {onShare && (
                  <button
                    type="button"
                    onClick={() => onShare(model)}
                    className="flex items-center gap-1 rounded-xl bg-green-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm active:scale-95"
                  >
                    <MessageCircle className="size-3.5" />
                    <span className="hidden sm:inline">Partager</span>
                  </button>
                )}
              </div>
            </div>

            {/* BANDEAU MINIATURES DES PHOTOS DU MODÈLE ACTUEL */}
            {photos.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-none">
                {photos.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                      setPhotoIndex(i);
                    }}
                    className={`relative size-10 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                      i === photoIndex
                        ? "border-primary ring-2 ring-primary/60 scale-105 opacity-100"
                        : "border-white/20 opacity-60 hover:opacity-100"
                    }`}
                  >
                    <StoredImage path={p} alt={`Vue ${i + 1}`} className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
