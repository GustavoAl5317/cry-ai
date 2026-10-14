import { Suspense } from "react";
import { MeetingWorkspace } from "@/components/MeetingWorkspace";
import { Spinner } from "@/components/ui";

// The meeting id is only known at request time, so it is read under Suspense.
export default function MeetingPage({ params }: PageProps<"/reuniao/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="grid h-dvh place-items-center text-zinc-500">
          <Spinner size={20} />
        </div>
      }
    >
      <MeetingWorkspace params={params} />
    </Suspense>
  );
}
