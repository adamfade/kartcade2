// /admin/track-builder: the saved-track library, or one track open in the editor.
//   ?id=<project id>      open a saved track
//   ?new=road | circuit   start a new one (saved on first Save)

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import TrackLibrary from './trackbuilder/TrackLibrary';
import TrackEditor from './trackbuilder/TrackEditor';
import { explainFirestoreError, loadProject, newProject } from './trackbuilder/trackProjects';
import type { TrackProject } from './trackbuilder/trackProjects';

const TrackBuilderPage: React.FC = () => {
    const [params] = useSearchParams();
    const id = params.get('id');
    const fresh = params.get('new');
    const [project, setProject] = useState<TrackProject | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editorKey, setEditorKey] = useState(0);
    const open = (p: TrackProject) => { setProject(p); setEditorKey((k) => k + 1); };

    useEffect(() => {
        setError(null);
        if (fresh === 'road' || fresh === 'circuit') { open(newProject(fresh)); return; }
        if (!id) { setProject(null); return; }
        // Already open (e.g. the URL gained ?id= after a first save): keep the editor as it is.
        if (project?.id === id || (project && !project.id)) return;
        setProject(null);
        loadProject(id).then((p) => (p ? open(p) : setError('That track was not found. It may have been deleted.'))).catch((e) => setError(explainFirestoreError(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, fresh]);

    let body: React.ReactNode;
    if (error) body = <div className="max-w-5xl mx-auto text-[#ff6b6b]">{error}</div>;
    else if (!id && !fresh) body = <TrackLibrary />;
    else if (!project) body = <div className="max-w-5xl mx-auto text-white/50 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Opening track…</div>;
    else body = <TrackEditor key={editorKey} initial={project} />;

    return <div className="min-h-screen bg-[#0A0A0A] text-white pt-24 pb-16 px-4">{body}</div>;
};

export default TrackBuilderPage;
