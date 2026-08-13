import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/lib/actions";
import AppShell from "@/components/AppShell";
import WonCelebration from "@/components/WonCelebration";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppShell user={{ name: user.name, email: user.email }} logoutAction={logout}>
        {children}
      </AppShell>
      <WonCelebration />
    </>
  );
}
