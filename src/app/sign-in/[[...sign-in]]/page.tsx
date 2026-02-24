import { SignIn } from "@clerk/nextjs";

export default function SignInPage(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <SignIn forceRedirectUrl="/" />
    </main>
  );
}
