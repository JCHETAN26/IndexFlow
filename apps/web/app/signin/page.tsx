import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { GUEST_ENABLED } from "@/lib/demo";

export const metadata = { title: "Sign in · IndexFlow" };

export default async function SignInPage() {
  // Already signed in? Go home.
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to IndexFlow</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Hybrid workspace search across your files and connected sources.
      </p>

      <form
        className="mt-8"
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50"
        >
          Continue with Google
        </button>
      </form>

      {/* Public demo: no Google account needed just to look around. */}
      {GUEST_ENABLED && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            or
            <span className="h-px flex-1 bg-neutral-200" />
          </div>

          <form
            action={async () => {
              "use server";
              await signIn("guest", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
            >
              Continue as guest
            </button>
          </form>
          <p className="mt-3 text-xs text-neutral-500">
            Read-only. Explore the public demo corpus, search it, and run the live evaluation
            without signing in.
          </p>
        </>
      )}
    </div>
  );
}
