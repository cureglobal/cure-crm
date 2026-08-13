import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getStages } from "@/lib/stages.server";
import { logout } from "@/lib/actions";
import AppShell from "@/components/AppShell";
import WonCelebration from "@/components/WonCelebration";
import OnboardingTour from "@/components/OnboardingTour";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const stages = await getStages();

  return (
    <>
      <AppShell
        user={{ name: user.name, email: user.email, avatarDataUrl: user.avatarDataUrl }}
        logoutAction={logout}
        stages={stages}
      >
        {children}
      </AppShell>
      <WonCelebration />
      <OnboardingTour show={!user.onboardingSeenAt} />
    </>
  );
}
