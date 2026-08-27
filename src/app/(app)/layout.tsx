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
  const stages = await getStages();
  const pipelines = await getPipelines();
  const dealTags = await getTags("deal");
  const companyTags = await getTags("company");
  const personTags = await getTags("person");
  const unreadCount = await getUnreadNotificationCount();

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
