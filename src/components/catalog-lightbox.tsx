import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
  Scissors,
  MessageCircle,
  Maximize2,
  Minimize2,
  Layers,
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
  /** Tous les modèles du catalogue pour naviguer de l'un à l'autre */
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
  // Remplir (cover) par défaut pour 100% plein écran sans AUCUNE bande latérale
  const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");
  const [showCatalogDrawer, setShowCatalogDrawer] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const pinchDistRef = useRef<number | null>(null);
  const pinchZoomRef = useRef(1);

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
      setFitMode("cover"); // Plein écran bord-à-bord immédiat, zéro bande noire latérale
      setShowCatalogDrawer(false);
    }
  }, [open, initialModelIndex, initialPhotoIndex, models.length]);

  /* ── Verrouillage du défilement global de la page ─────────────── */
  useEffect(() => {
    if (open) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [open]);

  /* ── Navigation Clavier ───────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prevPhoto();
      else if (e.key === "ArrowRight") nextPhoto();
      else if (e.key === "ArrowUp") prevModel();
      else if (e.key === "ArrowDown") nextModel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, photos.length, models.length]);

  /* ── Navigation entre Photos d'un modèle ───────────────────────── */
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

  /* ── Navigation Slalom entre Modèles du Catalogue ─────────────── */
  const prevModel = useCallback(() => {
    if (models.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setModelIndex((i) => (i === 0 ? models.length - 1 : i - 1));
    setPhotoIndex(0);
  }, [models.length]);

  const nextModel = useCallback(() => {
    if (models.length <= 1) return;
    setZoom(1); setPan({ x: 0, y: 0 });
    setModelIndex((i) => (i === models.length - 1 ? 0 : i + 1));
    setPhotoIndex(0);
  }, [models.length]);

  /* ── Zoom tactile & souris ────────────────────────────────────── */
  const zoomIn = () => setZoom((z) => Math.min(3.5, +(z + 0.5).toFixed(1)));
  const zoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, +(z - 0.5).toFixed(1));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleDoubleTap = (cx: number, cy: number) => {
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
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchDistRef.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const newZ = Math.min(3.5, Math.max(1, +(pinchZoomRef.current * dist / pinchDistRef.current).toFixed(2)));
      setZoom(newZ);
      if (newZ === 1) setPan({ x: 0, y: 0 });
      return;
    }

    if (e.touches.length === 1 && isDragging && zoom > 1) {
      const t = e.touches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      const maxX = (window.innerWidth * (zoom - 1)) / 2;
      const maxY = (window.innerHeight * (zoom - 1)) / 2;
      setPan({
        x: Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy)),
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    pinchDistRef.current = null;
    if (!isDragging) return;
    setIsDragging(false);

    if (zoom === 1 && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const dx = t.clientX - dragStartRef.current.x;
      const dy = t.clientY - dragStartRef.current.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Glissement horizontal : photo suivante/précédente (ou modèle si 1 photo)
      if (absDx > 45 && absDx > absDy * 1.2) {
        if (photos.length > 1) {
          dx < 0 ? nextPhoto() : prevPhoto();
        } else {
          dx < 0 ? nextModel() : prevModel();
        }
      } else if (absDy > 60 && absDy > absDx * 1.2) {
        // Glissement vertical : modèle suivant/précédent (slalom)
        dy < 0 ? nextModel() : prevModel();
      }
    }
  };

  /* ── Gestes Souris (Desktop) ──────────────────────────────────── */
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const maxX = (window.innerWidth * (zoom - 1)) / 2;
    const maxY = (window.innerHeight * (zoom - 1)) / 2;
    setPan({
      x: Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx)),
      y: Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy)),
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  if (!open || !model) return null;
  if (typeof document === "undefined") return null;

  const catLabel = categoryLabel ? categoryLabel(model.category) : model.category;
  const priceStr = model.default_price && formatPrice ? formatPrice(model.default_price) : null;

  /* ── Utilisation de createPortal directement sur document.body ──
     Cela garantit que la visionneuse passe AU-DESSUS DE TOUT (au-dessus du header
     et au-dessus de la barre de navigation basse d'accueil de l'application).
  ───────────────────────────────────────────────────────────────── */
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plein écran : ${model.name}`}
      className="fixed inset-0 z-[99999] flex flex-col bg-black text-white select-none animate-in fade-in duration-150 overflow-hidden"
      style={{
        width: "100vw",
        height: "100dvh",
        maxHeight: "100dvh",
      }}
      onMouseUp={handleMouseUp}
    >
      {/* ══════════════════════════════════════════════════════════════════
          1. BARRE DE NAVIGATION SUPÉRIEURE (BLINDÉE, ÉCLATANTE, ULTRA-VISIBLE)
         ══════════════════════════════════════════════════════════════════ */}
      <header
        className="relative z-50 shrink-0 bg-neutral-950/90 border-b border-white/20 px-3 py-2.5 sm:px-5 backdrop-blur-md"
        style={{
          paddingTop: "max(env(safe-area-inset-top, 12px), 12px)",
        }}
      >
        <div className="flex items-center justify-between gap-2 max-w-7xl mx-auto w-full">
          {/* BOUTON RETOUR : BLANC & NOIR, LUMINEUX, IMPOSSIBLE À RATER */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs sm:text-sm font-black text-neutral-950 shadow-2xl hover:bg-neutral-200 active:scale-95 transition-all cursor-pointer ring-2 ring-white/50"
            title="Revenir au catalogue"
          >
            <ArrowLeft className="size-4.5 stroke-[3]" />
            <span>Retour</span>
          </button>

          {/* SÉLECTEUR RAPIDE DE MODÈLE (SLALOM ENTRE LES CATALOGUES) */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={prevModel}
              disabled={models.length <= 1}
              className="flex size-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
              title="Modèle précédent"
            >
              <ChevronLeft className="size-4.5 stroke-[2.5]" />
            </button>

            <div className="text-center px-1 truncate max-w-[150px] sm:max-w-xs">
              <p className="text-xs sm:text-sm font-black text-white truncate">{model.name}</p>
              <p className="text-[10px] text-white/70 font-semibold truncate">
                {modelIndex + 1}/{models.length} · {catLabel}
              </p>
            </div>

            <button
              type="button"
              onClick={nextModel}
              disabled={models.length <= 1}
              className="flex size-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
              title="Modèle suivant"
            >
              <ChevronRight className="size-4.5 stroke-[2.5]" />
            </button>
          </div>

          {/* ACTIONS HAUT-DROITE : LISTE COMPLÈTE & FERMETURE */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Tiroir pour voir tous les modèles du catalogue */}
            <button
              type="button"
              onClick={() => setShowCatalogDrawer((v) => !v)}
              className={`flex items-center gap-1 rounded-full px-3 py-2 text-xs font-bold transition-all shadow-md ${
                showCatalogDrawer
                  ? "bg-primary text-primary-foreground font-black"
                  : "bg-white/15 text-white hover:bg-white/25"
              }`}
              title="Voir toute la liste des modèles"
            >
              <Layers className="size-3.5" />
              <span className="hidden sm:inline">Modèles ({models.length})</span>
            </button>

            {/* Bouton Remplir / Adapter */}
            <button
              type="button"
              onClick={() => setFitMode((m) => (m === "cover" ? "contain" : "cover"))}
              className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-2 text-xs font-bold text-white hover:bg-white/25 active:scale-95"
              title={fitMode === "cover" ? "Adapter le vêtement complet" : "Remplir 100% sans bordures"}
            >
              {fitMode === "cover" ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span className="hidden sm:inline">{fitMode === "cover" ? "Adapter" : "Remplir"}</span>
            </button>

            {/* Bouton Fermer (X) */}
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 items-center justify-center rounded-full bg-red-600/90 text-white hover:bg-red-600 active:scale-95 transition-all shadow-md ml-0.5"
              title="Fermer"
            >
              <X className="size-5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          2. ZONE PHOTO CENTRALE (Bord-à-Bord Absolu, ZÉRO BANDE LATÉRALE)
         ══════════════════════════════════════════════════════════════════ */}
      <div
        className={`relative flex-1 flex items-center justify-center overflow-hidden touch-none w-full h-full ${
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        {/* Fond d'ambiance flouté dynamique (garantit 0 bande noire même si l'image est adaptée) */}
        {currentPhoto && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
            <StoredImage
              path={currentPhoto}
              alt="fond d'ambiance"
              className="size-full object-cover blur-3xl scale-125 opacity-45 brightness-90 transition-all duration-300"
            />
          </div>
        )}

        {/* Image du vêtement : object-cover par défaut pour 100% plein écran sans aucune bande latérale */}
        {currentPhoto ? (
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-75 ease-out w-full h-full"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: "center center",
            }}
            onDoubleClick={(e) => handleDoubleTap(e.clientX, e.clientY)}
          >
            <StoredImage
              path={currentPhoto}
              alt={`${model.name} - vue ${photoIndex + 1}`}
              className={`size-full ${
                fitMode === "cover" ? "object-cover" : "object-contain"
              } pointer-events-none drop-shadow-2xl transition-all duration-200`}
            />
          </div>
        ) : (
          <div className="text-center text-white/50 space-y-3 z-10">
            <Scissors className="mx-auto size-16 stroke-[1]" />
            <p className="text-sm font-medium">Aucune photo pour ce modèle</p>
          </div>
        )}

        {/* Flèches de navigation entre les photos (gauche / droite) */}
        {photos.length > 1 && zoom === 1 && (
          <>
            <button
              type="button"
              onClick={prevPhoto}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 active:scale-90 transition-all shadow-2xl backdrop-blur-md border border-white/30"
              title="Photo précédente"
            >
              <ChevronLeft className="size-7 stroke-[2.5]" />
            </button>
            <button
              type="button"
              onClick={nextPhoto}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex size-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/90 active:scale-90 transition-all shadow-2xl backdrop-blur-md border border-white/30"
              title="Photo suivante"
            >
              <ChevronRight className="size-7 stroke-[2.5]" />
            </button>
          </>
        )}

        {/* Indicateur de zoom actif */}
        {zoom > 1 && (
          <div className="absolute bottom-4 left-4 z-20 rounded-full bg-black/80 px-3.5 py-1 text-xs font-bold text-white border border-white/20 shadow-xl backdrop-blur-md pointer-events-none">
            🔍 {Math.round(zoom * 100)}% — Glissez pour parcourir
          </div>
        )}

        {/* TIROIR MODÈLES DU CATALOGUE (S'affiche en 1 clic pour slalomer d'une tenue à une autre) */}
        {showCatalogDrawer && (
          <div className="absolute inset-x-3 bottom-3 top-3 z-40 flex flex-col rounded-3xl bg-neutral-950/95 p-4 border border-white/20 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-white/15">
              <div className="flex items-center gap-2">
                <Layers className="size-5 text-primary" />
                <h4 className="font-black text-sm sm:text-base text-white">
                  Tous les modèles du catalogue ({models.length})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowCatalogDrawer(false)}
                className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="size-4.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 pt-3">
              {models.map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setModelIndex(idx);
                    setPhotoIndex(0);
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                    setShowCatalogDrawer(false);
                  }}
                  className={`group flex flex-col text-left overflow-hidden rounded-2xl border-2 transition-all p-1.5 ${
                    idx === modelIndex
                      ? "border-primary bg-primary/20 ring-2 ring-primary/50"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-black/40">
                    {m.photo_paths?.[0] ? (
                      <StoredImage path={m.photo_paths[0]} alt={m.name} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-white/40">
                        <Scissors className="size-6" />
                      </div>
                    )}
                    <span className="absolute top-1 left-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-black text-white">
                      #{idx + 1}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold text-white truncate px-1">{m.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          3. BARRE INFÉRIEURE : INFOS MODÈLE, ZOOM, MINIATURES & WHATSAPP
         ══════════════════════════════════════════════════════════════════ */}
      <footer
        className="relative z-50 shrink-0 bg-neutral-950/90 border-t border-white/20 px-3 py-2 sm:px-5 backdrop-blur-md"
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom, 10px), 10px)",
        }}
      >
        <div className="max-w-7xl mx-auto w-full space-y-2">
          {/* LIGNE INFO ET CONTRÔLES */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-white truncate">{model.name}</h3>
                {priceStr && <span className="font-black text-xs sm:text-sm text-primary">{priceStr}</span>}
              </div>
              {model.fabric_needed && (
                <p className="text-[10px] sm:text-xs text-white/70 truncate">🧵 {model.fabric_needed}</p>
              )}
            </div>

            {/* BOUTONS : ZOOM & WHATSAPP / COMMANDER */}
            <div className="flex items-center gap-2 shrink-0">
              {/* ZOOM CONTROLS */}
              <div className="flex items-center rounded-full bg-white/15 p-0.5">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= 1}
                  className="flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <span className="px-1.5 text-[10px] font-mono font-bold text-white/90">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= 3.5}
                  className="flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>

              {/* COMMANDER */}
              {onOrder && (
                <button
                  type="button"
                  onClick={() => onOrder(model)}
                  className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-black text-primary-foreground shadow-md active:scale-95"
                >
                  <Scissors className="size-3.5" />
                  <span>Commander</span>
                </button>
              )}

              {/* WHATSAPP */}
              {onShare && (
                <button
                  type="button"
                  onClick={() => onShare(model)}
                  className="flex items-center gap-1.5 rounded-full bg-green-600 px-3.5 py-1.5 text-xs font-black text-white shadow-md active:scale-95"
                >
                  <MessageCircle className="size-3.5" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </button>
              )}
            </div>
          </div>

          {/* BANDEAU MINIATURES DES PHOTOS (Si le modèle a plus d'1 photo) */}
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
                  className={`relative size-11 shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                    i === photoIndex
                      ? "border-primary ring-2 ring-primary/60 scale-105 opacity-100"
                      : "border-white/25 opacity-60 hover:opacity-100"
                  }`}
                >
                  <StoredImage path={p} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>,
    document.body
  );
}
