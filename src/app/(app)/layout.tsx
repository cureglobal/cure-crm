import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { getPipelines } from "@/lib/pipelines.server";
import { getTags } from "@/lib/tags.server";
import { logout, getUnreadNotificationCount } from "@/lib/actions";
import AppShell from "@/components/AppShell";
import WonCelebration from "@/components/WonCelebration";
import OnboardingTour from "@/components/OnboardingTour";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Uavhengige spørringer — kjøres parallelt i stedet for i serie, siden
  // dette gjelder HVER ENESTE sidenavigasjon i hele appen (produksjon går
  // mot en ekstern Turso-database, så hvert await er en ekte nettverkstur).
  const [stages, pipelines, dealTags, companyTags, personTags, unreadCount] = await Promise.all([
    getStages(),
    getPipelines(),
    getTags("deal"),
    getTags("company"),
    getTags("person"),
    getUnreadNotificationCount(),
  ]);

  return (
    <>
      <AppShell
        user={{ name: user.name, email: user.email, avatarDataUrl: user.avatarDataUrl }}
        logoutAction={logout}
        stages={stages}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        importTags={{
          deals: dealTags.map((t) => ({ id: t.id, label: t.label })),
          bedrifter: companyTags.map((t) => ({ id: t.id, label: t.label })),
          personer: personTags.map((t) => ({ id: t.id, label: t.label })),
        }}
        initialUnreadCount={unreadCount}
      >
        {children}
      </AppShell>
      <WonCelebration />
      <OnboardingTour show={!user.onboardingSeenAt} />
    </>
  );
}
