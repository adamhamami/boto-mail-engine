import { processUnsubscribe } from "@/lib/mail/unsubscribe";

type PageProps = { params: Promise<{ token: string }> };

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;

  let message =
    "Votre demande de désinscription a bien été prise en compte.";
  let error: string | null = null;

  try {
    const result = await processUnsubscribe(token);
    if (result.alreadyUnsubscribed) {
      message = "Cette adresse était déjà désinscrite de nos envois.";
    }
  } catch {
    error =
      "Lien de désinscription invalide ou expiré. Contactez contact@botoschool.ma si besoin.";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium tracking-wide text-teal-700 dark:text-teal-400">
          BotoSchool
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">
          Désinscription
        </h1>
        {error ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {message}
          </p>
        )}
        <p className="mt-6 text-xs text-slate-500">
          Vous ne recevrez plus d&apos;emails de prospection de notre part.
        </p>
      </div>
    </main>
  );
}
