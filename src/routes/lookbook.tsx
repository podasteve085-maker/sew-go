import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Scissors,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Coins,
  Sparkles,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchCatalogModels, type CatalogModelRow } from "@/lib/queries";
import { CATALOG_CATEGORIES, catalogCategoryLabel, copyTextToClipboard, lookbookAbsoluteUrl } from "@/lib/domain";
import { fcfa, cleanPhone, waLink } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StoredImage } from "@/components/bits";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export const Route = createFileRoute("/lookbook")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Catalogue & Lookbook — CouturPro" },
      {
        name: "description",
        content: "Découvrez les modèles de confection sur mesure de l'atelier.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    atelierId: typeof search["atelierId"] === "string" ? search["atelierId"] : undefined,
    modelId: typeof search["modelId"] === "string" ? search["modelId"] : undefined,
    name: typeof search["name"] === "string" ? search["name"] : undefined,
    price: typeof search["price"] === "string" ? search["price"] : undefined,
    fabric: typeof search["fabric"] === "string" ? search["fabric"] : undefined,
    desc: typeof search["desc"] === "string" ? search["desc"] : undefined,
    atelier: typeof search["atelier"] === "string" ? search["atelier"] : undefined,
    phone: typeof search["phone"] === "string" ? search["phone"] : undefined,
  }),
  component: PublicLookbookPage,
});

function PublicLookbookPage() {
  const search = Route.useSearch();
  const atelierId = search.atelierId;
  const targetModelId = search.modelId;

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeModel, setActiveModel] = useState<CatalogModelRow | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const openedSharedModel = useRef(false);

  // Charger les données de l'atelier si un ID est fourni
  const atelierQuery = useQuery({
    queryKey: ["public-atelier", atelierId],
    queryFn: async () => {
      if (!atelierId) return null;
      const columns = "id, name, phone, whatsapp, address, city, currency, logo_url";
      // 1. Appel via la fonction RPC sécurisée et scopée par identifiant strict
      try {
        const { data, error } = await supabase.rpc("get_public_lookbook_atelier", {
          p_atelier_id: atelierId,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data[0];
        }
      } catch {
        // Repli si la fonction n'est pas encore migrée
      }

      // 2. Repli sur la vue publique restreinte
      try {
        const viewRes = await supabase
          .from("atelier_lookbook_public")
          .select("id, name, city, currency, logo_url")
          .eq("id", atelierId)
          .maybeSingle();
        if (!viewRes.error && viewRes.data) return viewRes.data;
      } catch {
        // Vue publique pas encore déployée
      }
      return null;
    },
    enabled: Boolean(atelierId),
  });

  const atelierName = atelierQuery.data?.name || search.atelier || "Atelier CouturPro";
  const atelierPhone = atelierQuery.data?.whatsapp || atelierQuery.data?.phone || search.phone || "";

  // Charger les modèles du catalogue
  const modelsQuery = useQuery({
    queryKey: ["public-catalog-models", atelierId],
    queryFn: async () => {
      if (atelierId) {
        return await fetchCatalogModels("all", atelierId, { publicAccess: true });
      }
      return [];
    },
    enabled: Boolean(atelierId),
  });

  const allModels = modelsQuery.data ?? [];
  const visibleModels = useMemo(() => {
    if (selectedCategory === "all") return allModels;
    return allModels.filter((m) => m.category === selectedCategory);
  }, [allModels, selectedCategory]);

  // Si des paramètres d'un modèle partagé sont dans l'URL, créer un modèle virtuel si non chargé
  const featuredModel: CatalogModelRow | null = useMemo(() => {
    if (targetModelId) {
      const found = allModels.find((m) => m.id === targetModelId);
      if (found) return found;
    }
    if (search.name) {
      return {
        id: targetModelId || "shared-model",
        business_id: atelierId || "",
        name: search.name,
        category: "boubou",
        description: search.desc || null,
        default_price: search.price ? Number(search.price) : null,
        fabric_needed: search.fabric || null,
        photo_paths: [],
        tags: [],
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    return null;
  }, [allModels, targetModelId, search.name, search.price, search.fabric, search.desc, atelierId]);

  useEffect(() => {
    if (openedSharedModel.current || !targetModelId || !featuredModel) return;
    if (featuredModel.id !== targetModelId) return;
    openedSharedModel.current = true;
    setActiveModel(featuredModel);
    setCurrentPhotoIndex(0);
  }, [featuredModel, targetModelId]);

  function handleOrderWhatsApp(model: CatalogModelRow | { name: string; default_price?: number | null }) {
    const rawPhone = cleanPhone(atelierPhone);
    const priceTxt = model.default_price ? ` (${fcfa(model.default_price, atelierQuery.data?.currency)})` : "";
    const msg = `Bonjour ${atelierName} ! 👋\n\nJ'ai découvert votre modèle *"${model.name}"*${priceTxt} sur votre catalogue en ligne.\nJe souhaiterais passer commande pour une confection sur mesure. Est-il disponible ?`;
    const wa = waLink(rawPhone, msg);
    if (wa) {
      window.open(wa, "_blank");
    } else {
      toast.info("Veuillez contacter l'atelier directement.");
    }
  }

  async function handleCopyPageLink() {
    const link =
      atelierId ? lookbookAbsoluteUrl(atelierId, targetModelId) : (typeof window !== "undefined" ? window.location.href : "");
    if (!link) return;
    const ok = await copyTextToClipboard(link);
    if (!ok) {
      toast.error("Impossible de copier le lien");
      return;
    }
    setCopied(true);
    toast.success("Lien du catalogue copié !");
    setTimeout(() => setCopied(false), 2500);
  }

  function openDetail(model: CatalogModelRow) {
    setActiveModel(model);
    setCurrentPhotoIndex(0);
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      {/* En-tête de l'Atelier / Lookbook */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 sm:size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Scissors className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-sm sm:text-base font-bold leading-tight line-clamp-1">
                {atelierName}
              </h1>
              <p className="text-[0.68rem] sm:text-xs text-muted-foreground flex items-center gap-1 font-medium">
                <Sparkles className="size-3 text-primary" /> Catalogue & Lookbook officiel
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCopyPageLink()}
              className="h-8.5 text-xs font-semibold rounded-xl"
            >
              {copied ? <Check className="mr-1 size-3.5 text-success" /> : <Copy className="mr-1 size-3.5" />}
              <span className="hidden sm:inline">Copier le lien</span>
            </Button>
            {atelierPhone && (
              <a
                href={waLink(cleanPhone(atelierPhone), `Bonjour ${atelierName}, je consulte votre catalogue de confections sur mesure !`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl bg-success px-3 text-xs font-bold text-success-foreground shadow-xs hover:opacity-90"
              >
                <MessageCircle className="size-3.5" />
                <span>WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 sm:px-6 pt-4 sm:pt-6 space-y-6">
        {!atelierId && (
          <div className="card-soft p-8 text-center space-y-2">
            <Scissors className="mx-auto size-12 text-muted-foreground/50 stroke-[1.5]" />
            <h3 className="font-display text-base font-bold">Lien de catalogue incomplet</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Demandez à l'atelier de vous renvoyer le lien de son lookbook pour voir les modèles et les photos.
            </p>
          </div>
        )}
        {/* Modèle mis en avant si partagé via lien direct */}
        {featuredModel && (
          <section className="card-soft overflow-hidden border-2 border-primary/30 bg-primary/5 p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col md:flex-row gap-5 items-center">
              {featuredModel.photo_paths && featuredModel.photo_paths.length > 0 ? (
                <div
                  onClick={() => openDetail(featuredModel)}
                  className="relative aspect-square w-full md:w-64 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-border bg-muted shadow-sm"
                >
                  <StoredImage
                    path={featuredModel.photo_paths[0]}
                    alt={featuredModel.name}
                    className="size-full object-cover transition-transform hover:scale-105 duration-300"
                  />
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white backdrop-blur">
                    Voir les photos
                  </span>
                </div>
              ) : null}

              <div className="flex-1 space-y-2.5 text-center md:text-left">
                <span className="inline-block rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-bold text-primary">
                  ✨ Modèle recommandé par l'atelier
                </span>
                <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
                  {featuredModel.name}
                </h2>
                {featuredModel.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground whitespace-pre-wrap max-w-xl">
                    {featuredModel.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1 text-xs sm:text-sm">
                  {featuredModel.default_price ? (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-primary/10 px-3 py-1 font-bold text-primary">
                      <Coins className="size-4" /> {fcfa(featuredModel.default_price, atelierQuery.data?.currency)}
                    </span>
                  ) : null}
                  {featuredModel.fabric_needed ? (
                    <span className="rounded-xl bg-muted px-3 py-1 font-medium text-muted-foreground">
                      🧵 Tissu : {featuredModel.fabric_needed}
                    </span>
                  ) : null}
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => handleOrderWhatsApp(featuredModel)}
                    className="h-11 w-full sm:w-auto px-6 font-bold text-sm rounded-xl shadow-md bg-success hover:bg-success/90 text-success-foreground"
                  >
                    <MessageCircle className="mr-2 size-4.5" /> Commander ce modèle sur WhatsApp
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Puces de filtrage par catégorie */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all ${
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            🌟 Tous les modèles
          </button>
          {CATALOG_CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setSelectedCategory(c.value)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all ${
                selectedCategory === c.value
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{c.icon}</span>
              <span>{c.label.split("&")[0]?.trim()}</span>
            </button>
          ))}
        </div>

        {/* Grille des confections */}
        {modelsQuery.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="card-soft h-56 animate-pulse bg-muted/60" />
            ))}
          </div>
        ) : modelsQuery.isError ? (
          <div className="card-soft p-10 text-center space-y-3">
            <Scissors className="mx-auto size-12 text-muted-foreground/50 stroke-[1.5]" />
            <h3 className="font-display text-base font-bold">Catalogue momentanément indisponible</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Impossible de charger les modèles de cet atelier. Vérifiez le lien reçu ou contactez l'atelier sur WhatsApp.
            </p>
            {atelierPhone && (
              <a
                href={waLink(cleanPhone(atelierPhone), `Bonjour ${atelierName}, je souhaite découvrir vos modèles !`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-success px-4 py-2 text-xs font-bold text-success-foreground"
              >
                <MessageCircle className="size-4" /> Écrire à l'atelier
              </a>
            )}
          </div>
        ) : visibleModels.length === 0 && !featuredModel ? (
          <div className="card-soft p-10 text-center space-y-3">
            <Scissors className="mx-auto size-12 text-muted-foreground/50 stroke-[1.5]" />
            <h3 className="font-display text-base font-bold">Catalogue en cours de mise à jour</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              L'atelier n'a pas encore publié de modèle dans cette catégorie. Contactez directement l'atelier sur WhatsApp pour découvrir les confections récentes.
            </p>
            {atelierPhone && (
              <a
                href={waLink(cleanPhone(atelierPhone), `Bonjour ${atelierName}, je souhaite découvrir vos modèles !`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-success px-4 py-2 text-xs font-bold text-success-foreground"
              >
                <MessageCircle className="size-4" /> Écrire à l'atelier
              </a>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {visibleModels.map((model) => {
              const coverPhoto = model.photo_paths?.[0];
              return (
                <div
                  key={model.id}
                  onClick={() => openDetail(model)}
                  className="card-soft group flex flex-col justify-between overflow-hidden border border-border cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-muted">
                    {coverPhoto ? (
                      <StoredImage
                        path={coverPhoto}
                        alt={model.name}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full flex-col items-center justify-center gap-1 bg-primary/5 text-primary/70">
                        <Scissors className="size-6 stroke-[1.5]" />
                        <span className="text-[0.65rem] font-bold">Sans photo</span>
                      </div>
                    )}
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[0.62rem] font-bold text-white shadow-xs">
                      {catalogCategoryLabel(model.category)}
                    </span>
                    {model.photo_paths && model.photo_paths.length > 1 && (
                      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[0.6rem] font-bold text-white backdrop-blur">
                        +{model.photo_paths.length - 1}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                    <h3 className="font-display text-xs sm:text-sm font-bold text-foreground line-clamp-1">
                      {model.name}
                    </h3>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      {model.default_price ? (
                        <span className="font-bold text-primary text-xs sm:text-sm">
                          {fcfa(model.default_price, atelierQuery.data?.currency)}
                        </span>
                      ) : (
                        <span className="text-[0.68rem] text-muted-foreground font-medium">Sur mesure</span>
                      )}
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-border/70">
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOrderWhatsApp(model);
                        }}
                        className="h-8 w-full text-xs font-bold rounded-lg bg-success hover:bg-success/90 text-success-foreground"
                      >
                        <MessageCircle className="mr-1 size-3.5" /> Commander
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-border/70 py-6 text-center text-xs text-muted-foreground mt-12 space-y-1.5">
        <p>Catalogue propulsé par <strong>CouturPro</strong> · Confection artisanale sur mesure</p>
        <p>
          <a href="/politique-confidentialite" className="text-primary hover:underline font-medium">
            Politique de Confidentialité & Protection des Données
          </a>
        </p>
      </footer>

      {/* Modal Plein Écran pour visualiser les photos du modèle */}
      {activeModel && (
        <Dialog open={Boolean(activeModel)} onOpenChange={() => setActiveModel(null)}>
          <DialogContent className="max-h-[95vh] max-w-2xl overflow-hidden p-0 bg-card border-border [&>button]:hidden">
            <div className="relative flex flex-col">
              {/* Grand affichage photo */}
              <div className="relative aspect-4/3 sm:aspect-16/10 w-full bg-black/95 flex items-center justify-center overflow-hidden">
                {activeModel.photo_paths && activeModel.photo_paths.length > 0 ? (
                  <StoredImage
                    path={activeModel.photo_paths[currentPhotoIndex] || activeModel.photo_paths[0]}
                    alt={activeModel.name}
                    className="size-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-white/60">
                    <Scissors className="size-16" />
                    <p className="text-sm">Pas de photo disponible</p>
                  </div>
                )}

                {activeModel.photo_paths && activeModel.photo_paths.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === 0 ? activeModel.photo_paths.length - 1 : prev - 1,
                        )
                      }
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
                    >
                      <ChevronLeft className="size-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPhotoIndex((prev) =>
                          prev === activeModel.photo_paths.length - 1 ? 0 : prev + 1,
                        )
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black"
                    >
                      <ChevronRight className="size-5" />
                    </button>
                    <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-1.5">
                      {activeModel.photo_paths.map((_, i) => (
                        <span
                          key={i}
                          className={`size-2 rounded-full transition-all ${
                            i === currentPhotoIndex ? "bg-white scale-125" : "bg-white/40"
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setActiveModel(null)}
                  className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Détails du modèle */}
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                      {catalogCategoryLabel(activeModel.category)}
                    </span>
                    <h2 className="mt-1 font-display text-lg sm:text-xl font-bold text-foreground">
                      {activeModel.name}
                    </h2>
                  </div>
                  {activeModel.default_price && (
                    <div className="text-right">
                      <p className="text-[0.65rem] uppercase font-bold text-muted-foreground">
                        Prix indicatif
                      </p>
                      <p className="font-display text-lg sm:text-xl font-bold text-primary">
                        {fcfa(activeModel.default_price, atelierQuery.data?.currency)}
                      </p>
                    </div>
                  )}
                </div>

                {activeModel.fabric_needed && (
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground">
                    🧵 Tissu recommandé : <strong className="text-foreground">{activeModel.fabric_needed}</strong>
                  </p>
                )}

                {activeModel.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {activeModel.description}
                  </p>
                )}

                <div className="pt-2">
                  <Button
                    onClick={() => handleOrderWhatsApp(activeModel)}
                    className="h-11 w-full font-bold text-sm rounded-xl bg-success hover:bg-success/90 text-success-foreground shadow-md"
                  >
                    <MessageCircle className="mr-2 size-4.5" /> Commander ce modèle sur WhatsApp
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
