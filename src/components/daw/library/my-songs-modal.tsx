"use client";

// ============================================================
// My Songs modal - list songs saved on this browser, open or
// delete them, and save the current project. Mounted when
// ui.modal === 'mySongs'.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Cloud, Loader2, LogOut, Music2, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useDAW } from "@/lib/daw/store";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import {
  deleteCloudProject,
  listCloudProjects,
  markCloudProjectOpened,
  restoreCloudProjectAudio,
  saveCloudProject,
  type CloudSavedSong,
} from "@/lib/daw/cloud-projects";
import {
  deleteSavedSong,
  getSavedSong,
  listSavedSongs,
  markSavedSongOpened,
  saveSong,
  type SavedSong,
} from "@/lib/daw/saved-songs";

const SCROLLBAR =
  "[scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#3a3a41] [&::-webkit-scrollbar-track]:bg-transparent";

type AuthView = "signIn" | "signUp" | "forgotPassword" | "updatePassword";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function MySongsModal() {
  const modal = useDAW((s) => s.ui.modal);
  const project = useDAW((s) => s.project);
  const loadProject = useDAW((s) => s.loadProject);
  const setModal = useDAW((s) => s.setModal);
  const { user, loading: authLoading, passwordRecovery } = useCloudAuth();
  const userId = user?.id;

  const open = modal === "mySongs";

  // null = loading, [] = loaded but empty
  const [songs, setSongs] = useState<SavedSong[] | null>(null);
  const [cloudProjects, setCloudProjects] = useState<{
    userId: string;
    songs: CloudSavedSong[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    cloud: boolean;
  } | null>(null);
  const [authView, setAuthView] = useState<AuthView>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const activeAuthView: AuthView = passwordRecovery ? "updatePassword" : authView;
  const activeAuthNotice = passwordRecovery
    ? "Choose a new password for your account."
    : authNotice;
  const cloudSongs = userId
    ? cloudProjects?.userId === userId
      ? cloudProjects.songs
      : null
    : [];

  const refresh = useCallback(async () => {
    try {
      setSongs(await listSavedSongs());
    } catch (error) {
      toast.error(`Could not load local songs: ${errorText(error, "Storage unavailable")}`);
    }
    if (!userId) return;
    try {
      setCloudProjects({ userId, songs: await listCloudProjects() });
    } catch (error) {
      setCloudProjects({ userId, songs: [] });
      toast.error(`Could not load cloud projects: ${errorText(error, "Cloud storage unavailable")}`);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadSongs = async () => {
      try {
        const savedSongs = await listSavedSongs();
        if (!cancelled) setSongs(savedSongs);
      } catch (error) {
        if (!cancelled) {
          setSongs([]);
          toast.error(`Could not load local songs: ${errorText(error, "Storage unavailable")}`);
        }
      }
    };

    void loadSongs();
    if (userId) {
      void listCloudProjects()
        .then((savedSongs) => {
          if (!cancelled) setCloudProjects({ userId, songs: savedSongs });
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setCloudProjects({ userId, songs: [] });
            toast.error(`Could not load cloud projects: ${errorText(error, "Cloud storage unavailable")}`);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const openSong = async (id: string) => {
    setOpeningId(id);
    try {
      const song = await getSavedSong(id);
      if (!song) throw new Error("song not found");
      loadProject(song.project); // also closes the modal
      try {
        await markSavedSongOpened(id);
      } catch (error) {
        toast.error(`Opened the song, but could not update its last-opened date: ${errorText(error, "Storage unavailable")}`);
      }
      toast.success(`Opened "${song.name}"`);
    } catch (error) {
      toast.error(`Could not open that song: ${errorText(error, "Song not found")}`);
    } finally {
      setOpeningId(null);
    }
  };

  const openCloudSong = async (song: CloudSavedSong) => {
    setOpeningId(`cloud:${song.id}`);
    try {
      await restoreCloudProjectAudio(song);
      loadProject(song.project);
      try {
        await markCloudProjectOpened(song.id);
      } catch (error) {
        toast.error(`Opened the project, but could not update its last-opened date: ${errorText(error, "Cloud storage unavailable")}`);
      }
      toast.success(`Opened "${song.name}" from your account`);
    } catch (error) {
      toast.error(`Could not open that cloud project: ${errorText(error, "Cloud audio unavailable")}`);
    } finally {
      setOpeningId(null);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      if (target.cloud) {
        await deleteCloudProject(target.id);
        if (userId) {
          setCloudProjects((saved) =>
            saved?.userId === userId
              ? { ...saved, songs: saved.songs.filter((song) => song.id !== target.id) }
              : saved,
          );
        }
        toast.success("Cloud project deleted");
      } else {
        await deleteSavedSong(target.id);
        setSongs((saved) =>
          saved ? saved.filter((song) => song.id !== target.id) : saved,
        );
        toast.success("Local song deleted");
      }
    } catch (error) {
      toast.error(`Delete failed: ${errorText(error, "Storage unavailable")}`);
    }
  };

  const saveCurrent = async () => {
    setSaving(true);
    try {
      const song = await saveSong(project);
      useDAW.setState((s) => ({ project: { ...s.project, id: song.id } }));
      if (user) {
        try {
          const cloudSong = await saveCloudProject(song.project);
          if (userId) {
            setCloudProjects((saved) => ({
              userId,
              songs: [
                cloudSong,
                ...(saved?.userId === userId ? saved.songs : []).filter(
                  (item) => item.id !== cloudSong.id,
                ),
              ],
            }));
          }
          toast.success("Saved on this device and to your account");
        } catch (error) {
          toast.error(`Saved on this device, but cloud sync failed: ${errorText(error, "Cloud storage unavailable")}`);
        }
      } else {
        toast.success("Saved on this device. Sign in to back it up to your account.");
      }
      await refresh();
    } catch (error) {
      toast.error(`Local save failed: ${errorText(error, "Storage unavailable")}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteSong = deleteTarget
    ? deleteTarget.cloud
      ? cloudSongs?.find((song) => song.id === deleteTarget.id)
      : songs?.find((song) => song.id === deleteTarget.id)
    : null;
  const cloudSongIds = new Set((cloudSongs ?? []).map((song) => song.id));
  const localOnlySongs = (songs ?? []).filter((song) => !cloudSongIds.has(song.id));

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getSupabaseClient();
    if (!supabase) {
      toast.error("Cloud accounts are not configured. See the Supabase setup instructions.");
      return;
    }

    setAuthBusy(true);
    setAuthNotice("");
    try {
      if (activeAuthView === "signIn") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in");
      } else if (activeAuthView === "signUp") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setAuthNotice("Check your email to confirm your account, then sign in.");
        } else {
          toast.success("Account created");
        }
      } else if (activeAuthView === "forgotPassword") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setAuthNotice("If an account exists for that email, a password reset link is on its way.");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setAuthView("signIn");
        setAuthNotice("Your password was updated.");
        toast.success("Password updated");
      }
    } catch (error) {
      toast.error(`Account action failed: ${errorText(error, "Please try again")}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAuthNotice("");
      setAuthView("signIn");
      toast.success("Signed out");
    } catch (error) {
      toast.error(`Could not sign out: ${errorText(error, "Please try again")}`);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && setModal("none")}>
        <DialogContent className={`sm:max-w-[480px] max-h-[88vh] overflow-y-auto bg-[#1d1d20] border-black/60 text-zinc-200 ${SCROLLBAR}`}>
          <DialogHeader>
            <DialogTitle className="text-zinc-100">My Songs</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Save locally or sign in to keep projects and audio available across devices.
            </DialogDescription>
          </DialogHeader>

          {!isSupabaseConfigured() ? (
            <div className="rounded-md border border-black/50 bg-[#19191b] p-3 text-[11px] leading-relaxed text-zinc-400">
              <p className="font-medium text-zinc-300">Cloud accounts are not configured</p>
              <p className="mt-1">
                Add the Supabase URL and public anon key, then apply{" "}
                <code className="text-[#ffb648]">supabase/schema.sql</code>. See the
                README for setup details.
              </p>
            </div>
          ) : authLoading ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Checking account...
            </div>
          ) : user && activeAuthView !== "updatePassword" ? (
            <div className="flex items-center gap-2 rounded-md border border-black/50 bg-[#19191b] px-3 py-2">
              <Cloud size={14} className="shrink-0 text-[#ffb648]" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                Signed in as {user.email}
              </p>
              <button
                type="button"
                onClick={signOut}
                className="flex h-7 shrink-0 items-center gap-1 rounded px-2 text-[10px] text-zinc-400 hover:bg-[#2f2f34] hover:text-zinc-100"
              >
                <LogOut size={12} aria-hidden />
                Sign out
              </button>
            </div>
          ) : (
            <form
              onSubmit={submitAuth}
              className="rounded-md border border-black/50 bg-[#19191b] p-3"
            >
              <p className="mb-2 text-[12px] font-medium text-zinc-200">
                {activeAuthView === "signUp"
                  ? "Create your account"
                  : activeAuthView === "forgotPassword"
                    ? "Reset your password"
                    : activeAuthView === "updatePassword"
                      ? "Choose a new password"
                      : "Sign in to your account"}
              </p>
              {activeAuthView !== "updatePassword" && (
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  aria-label="Email"
                  className="mb-2 h-8 border-black/50 bg-[#222226] text-[12px] text-zinc-200"
                />
              )}
              {activeAuthView !== "forgotPassword" && (
                <Input
                  type="password"
                  autoComplete={
                    activeAuthView === "signUp" || activeAuthView === "updatePassword"
                      ? "new-password"
                      : "current-password"
                  }
                  required
                  minLength={activeAuthView === "signIn" ? undefined : 8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={activeAuthView === "updatePassword" ? "New password" : "Password"}
                  aria-label={activeAuthView === "updatePassword" ? "New password" : "Password"}
                  className="mb-2 h-8 border-black/50 bg-[#222226] text-[12px] text-zinc-200"
                />
              )}
              {activeAuthNotice && (
                <p role="status" className="mb-2 text-[10px] leading-snug text-[#ffb648]">
                  {activeAuthNotice}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={authBusy}
                  className="h-7 rounded bg-[#ffb648] px-3 text-[11px] font-semibold text-[#1d1d20] hover:bg-[#ffc167] disabled:opacity-50"
                >
                  {authBusy
                    ? "Please wait..."
                    : activeAuthView === "signUp"
                      ? "Create account"
                      : activeAuthView === "forgotPassword"
                        ? "Send reset link"
                        : activeAuthView === "updatePassword"
                          ? "Update password"
                          : "Sign in"}
                </button>
                {activeAuthView === "signIn" && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthView("signUp");
                        setAuthNotice("");
                      }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200"
                    >
                      Create account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthView("forgotPassword");
                        setAuthNotice("");
                      }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-200"
                    >
                      Forgot password?
                    </button>
                  </>
                )}
                {activeAuthView !== "signIn" && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthView("signIn");
                      setAuthNotice("");
                    }}
                    className="text-[10px] text-zinc-400 hover:text-zinc-200"
                  >
                    Back to sign in
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Song list */}
          {songs === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-zinc-500">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Loading songs...
            </div>
          ) : localOnlySongs.length === 0 &&
            !cloudSongs?.length &&
            cloudSongs !== null ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[12px] text-zinc-600">
              <Music2 size={20} aria-hidden />
              No saved songs yet
            </div>
          ) : (
            <div
              className={`max-h-80 overflow-y-auto -mx-1 space-y-3 px-1 ${SCROLLBAR}`}
            >
              {user && cloudSongs === null && (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  Loading cloud projects...
                </div>
              )}
              {!!cloudSongs?.length && (
                <section>
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Your Cloud Projects
                  </h3>
                  {cloudSongs.map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-black/50 hover:bg-[#2a2a2f]"
                    >
                      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/40 bg-[#2a2a2f]">
                        <Cloud size={14} className="text-[#ffb648]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-zinc-200">{song.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {formatDistanceToNow(new Date(song.updatedAt), { addSuffix: true })}
                          {songs?.some((local) => local.id === song.id) ? " · also on this device" : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => void openCloudSong(song)}
                        disabled={openingId === `cloud:${song.id}`}
                        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[#ffb648] px-3 text-[11px] font-semibold text-[#1d1d20] transition-colors hover:bg-[#ffc167] disabled:opacity-50"
                      >
                        {openingId === `cloud:${song.id}` ? (
                          <Loader2 size={11} className="animate-spin" aria-hidden />
                        ) : (
                          <Cloud size={11} aria-hidden />
                        )}
                        Open
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ id: song.id, cloud: true })}
                        aria-label={`Delete cloud project ${song.name}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {!!localOnlySongs.length && (
                <section>
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    On This Device
                  </h3>
                  {localOnlySongs.map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-2.5 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-black/50 hover:bg-[#2a2a2f]"
                    >
                      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/40 bg-[#2a2a2f]">
                        <Music2 size={14} className="text-[#ffb648]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-zinc-200">{song.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {formatDistanceToNow(new Date(song.updatedAt), { addSuffix: true })}
                        </p>
                      </div>
                      <button
                        onClick={() => void openSong(song.id)}
                        disabled={openingId === song.id}
                        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[#ffb648] px-3 text-[11px] font-semibold text-[#1d1d20] transition-colors hover:bg-[#ffc167] disabled:opacity-50"
                      >
                        {openingId === song.id && <Loader2 size={11} className="animate-spin" aria-hidden />}
                        Open
                      </button>
                      <button
                        onClick={() => setDeleteTarget({ id: song.id, cloud: false })}
                        aria-label={`Delete ${song.name}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-red-400/10 hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}

          {/* Save current */}
          <div className="border-t border-black/50 pt-3 flex flex-col gap-2">
            <button
              onClick={saveCurrent}
              disabled={saving}
              className="h-8 self-start px-3 rounded-md bg-[#ffb648] text-[#1d1d20] text-[12px] font-semibold hover:bg-[#ffc167] transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Save size={13} aria-hidden />
              )}
              Save Current Song
            </button>
            <p className="text-[10px] text-zinc-600 leading-snug">
              {user
                ? "Saves both locally and to your account, including recordings and imported audio."
                : "Saves to this browser. Sign in above to back up projects and audio across devices."}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-[#1d1d20] border-black/60 text-zinc-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">
              Delete {deleteTarget?.cloud ? "Cloud Project" : "Local Song"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              This will permanently remove &quot;{deleteSong?.name}&quot; from{" "}
              {deleteTarget?.cloud ? "your account and cloud storage" : "this browser"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-black/60 bg-[#2f2f34] text-zinc-300 hover:bg-[#3a3a41] hover:text-zinc-200">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-400/40"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
