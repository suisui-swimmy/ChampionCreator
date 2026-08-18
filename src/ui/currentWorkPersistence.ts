import {
  saveBoxEntriesToBrowser,
  type BoxEntry,
} from "./boxStorage";
import {
  discardDraftFromBrowser,
  type DraftMutationResult,
} from "./draftStorage";

type CurrentWorkPersistenceDependencies = {
  saveBoxEntries?: (entries: BoxEntry[]) => string | null;
  discardDraft?: () => DraftMutationResult;
};

export type CurrentWorkPersistenceResult =
  | { status: "box-error"; message: string }
  | { status: "box-saved"; discardResult: DraftMutationResult };

export const persistCurrentWorkToBoxAndDiscardDraft = (
  entries: BoxEntry[],
  dependencies: CurrentWorkPersistenceDependencies = {},
): CurrentWorkPersistenceResult => {
  const saveBoxEntries = dependencies.saveBoxEntries ?? saveBoxEntriesToBrowser;
  const discardDraft = dependencies.discardDraft ?? discardDraftFromBrowser;
  const boxError = saveBoxEntries(entries);
  if (boxError) {
    return { status: "box-error", message: boxError };
  }

  return {
    status: "box-saved",
    discardResult: discardDraft(),
  };
};
