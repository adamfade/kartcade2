// 3D preview of a built track (three.js). Shows exactly the meshes and textures that go into the KN5.
// Overview: orbit and zoom. Ground view: double-click a point (or use Ground view) to stand at driver eye
// height; drag to look around, W/S or the buttons to move along the road, Drive to roll along it.
// When the editor has a scenery tool active, clicks on the track are reported as picks instead.
//
// Coordinates: AC is left-handed (X east, Y up, Z north); three.js is right-handed, so AC (x, y, z) is
// drawn at (x, y, -z). That keeps north ahead and east to the right, so sign text reads the right way.

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Car, ChevronLeft, ChevronRight, Eye, Globe2, MapPinned, Pause } from 'lucide-react';
import type { BuildResult } from '../../../tools/trackbuilder/pack.ts';
import type { ElementBuild } from '../../../tools/trackbuilder/elements.ts';
import type { MeshPart } from '../../../tools/trackbuilder/mesh.ts';
import type { Kn5Material, Kn5Texture } from '../../../tools/trackbuilder/kn5.ts';
import { decodeDds } from '../../../tools/trackbuilder/dds.ts';

export interface TrackPick { s: number; lateral: number; index: number }

interface Props {
    build: BuildResult;
    scenery: ElementBuild;
    /** A scenery tool is waiting for a click on the track. */
    picking: boolean;
    /** Distance (m) of a pending first click, drawn as a marker. */
    marker: number | null;
    onPick: (p: TrackPick) => void;
    /** Ask for ground view at this distance (nonce makes repeat requests fire). */
    goTo: { s: number; nonce: number } | null;
    className?: string;
}

type Mode = 'orbit' | 'ground';

const EYE = 1.15;
const DRIVE_SPEED = 22; // m/s, about 80 km/h

/**
 * KN5 texture -> three.js texture. DDS is decoded on the CPU (works on every GPU) and mipmapped by WebGL.
 * Rows are kept top-first (flipY false) and the mesh v is negated exactly as the KN5 writer does, so the
 * preview maps textures the way Assetto Corsa does.
 */
function textureFrom(t: Kn5Texture, renderer: THREE.WebGLRenderer): THREE.Texture {
    let tex: THREE.Texture;
    if (t.name.toLowerCase().endsWith('.dds')) {
        const d = decodeDds(t.data);
        tex = new THREE.DataTexture(d.rgba, d.width, d.height, THREE.RGBAFormat);
        tex.flipY = false;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
    } else {
        const url = URL.createObjectURL(new Blob([t.data], { type: 'image/png' }));
        tex = new THREE.Texture();
        tex.flipY = false;
        const img = new Image();
        img.onload = () => { tex.image = img; tex.needsUpdate = true; URL.revokeObjectURL(url); };
        img.src = url;
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
}

/**
 * ksPerPixelMultiMap_NMDetail as AC blends it: colour = macro.rgb * lerp(detail.rgb, 1, macro.a), lit in
 * gamma space (AC doesn't linearise textures), plus the scene fog.
 */
function macroDetailMaterial(macro: THREE.Texture | undefined, detail: THREE.Texture | undefined, detailMult: number, lights: Lights): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        fog: true,
        side: THREE.DoubleSide,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            macro: { value: macro ?? null }, detail: { value: detail ?? null }, detailMult: { value: detailMult },
            sunDir: { value: lights.sunDir }, sunCol: { value: lights.sunCol }, skyCol: { value: lights.skyCol }, groundCol: { value: lights.groundCol },
        }]),
        vertexShader: `
            varying vec2 vUv; varying vec3 vN;
            #include <fog_pars_vertex>
            void main() {
                vUv = uv; vN = normalize(normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }`,
        fragmentShader: `
            uniform sampler2D macro; uniform sampler2D detail; uniform float detailMult;
            uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyCol; uniform vec3 groundCol;
            varying vec2 vUv; varying vec3 vN;
            #include <fog_pars_fragment>
            void main() {
                vec4 m = texture2D(macro, vUv);
                vec3 d = texture2D(detail, vUv * detailMult).rgb;
                vec3 col = m.rgb * mix(d, vec3(1.0), m.a);
                vec3 n = normalize(vN);
                vec3 light = mix(groundCol, skyCol, n.y * 0.5 + 0.5) + sunCol * max(dot(n, sunDir), 0.0);
                gl_FragColor = vec4(col * light, 1.0);
                #include <fog_fragment>
            }`,
    });
}

interface Lights { sunDir: THREE.Vector3; sunCol: THREE.Color; skyCol: THREE.Color; groundCol: THREE.Color }
const LIGHTS: Lights = {
    sunDir: new THREE.Vector3(-0.5, 1, -0.35).normalize(),
    sunCol: new THREE.Color(0.62, 0.58, 0.52), skyCol: new THREE.Color(0.52, 0.56, 0.62), groundCol: new THREE.Color(0.3, 0.3, 0.28),
};

/** One group of three.js meshes for a set of KN5 parts, with its own textures (disposed together). */
function groupFrom(parts: MeshPart[], materials: Kn5Material[], textures: Kn5Texture[], renderer: THREE.WebGLRenderer) {
    const group = new THREE.Group();
    const used = new Set(materials.filter((m) => parts.some((p) => p.material === m.name)).flatMap((m) => m.textures.map((t) => t.texture)));
    const texByName = new Map(textures.filter((t) => used.has(t.name)).map((t) => [t.name, textureFrom(t, renderer)]));
    const matByName = new Map<string, THREE.Material>();
    for (const m of materials) {
        const slot = (s: string) => texByName.get(m.textures.find((t) => t.sampler === s)?.texture ?? '');
        if (m.shader === 'ksPerPixelMultiMap_NMDetail') {
            const mult = m.properties.find((p) => p.name === 'detailUVMultiplier')?.a ?? 1;
            matByName.set(m.name, macroDetailMaterial(slot('txDiffuse'), slot('txDetail'), mult, LIGHTS));
        } else {
            const map = slot('txDiffuse');
            if (map) map.colorSpace = THREE.SRGBColorSpace;
            matByName.set(m.name, new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : 0x888888, side: THREE.DoubleSide }));
        }
    }
    for (const p of parts) {
        if (p.visible === false || !p.indices.length) continue;
        const g = new THREE.BufferGeometry();
        const pos = new Float32Array(p.positions.length), nor = new Float32Array(p.normals.length), uv = new Float32Array(p.uvs.length);
        for (let i = 0; i < p.positions.length; i += 3) {
            pos[i] = p.positions[i]; pos[i + 1] = p.positions[i + 1]; pos[i + 2] = -p.positions[i + 2];
            nor[i] = p.normals[i]; nor[i + 1] = p.normals[i + 1]; nor[i + 2] = -p.normals[i + 2];
        }
        for (let i = 0; i < p.uvs.length; i += 2) { uv[i] = p.uvs[i]; uv[i + 1] = -p.uvs[i + 1]; }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(p.indices);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, matByName.get(p.material) ?? new THREE.MeshLambertMaterial({ color: 0xff00ff }));
        mesh.name = p.name;
        // Paint sits 12 mm above the asphalt: nudge it forward in depth so it never flickers at a distance.
        if (p.name.startsWith('PAINT_')) { (mesh.material as THREE.Material).polygonOffset = true; (mesh.material as THREE.Material).polygonOffsetFactor = -2; mesh.renderOrder = 1; }
        group.add(mesh);
    }
    const dispose = () => {
        group.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
        matByName.forEach((m) => m.dispose());
        texByName.forEach((t) => t.dispose());
    };
    return { group, dispose };
}

/**
 * Open Google Street View at distance s along the track, facing the direction of travel. Linking out with the
 * Maps URLs API is allowed; Street View imagery itself must never be copied into a track.
 */
export function openStreetView(build: BuildResult, s: number) {
    const c = build.centerline;
    const x = c.closed ? ((s % c.length) + c.length) % c.length : Math.max(0, Math.min(c.length, s));
    let i = 0;
    while (i < c.points.length - 1 && c.s[i + 1] <= x) i++;
    const ll = c.projection.toLatLon(c.points[i]);
    const t = c.tangents[i];
    const heading = Math.round(((Math.atan2(t.x, t.y) * 180) / Math.PI + 360) % 360);
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll.lat.toFixed(6)},${ll.lon.toFixed(6)}&heading=${heading}&pitch=0&fov=80`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

const TrackPreview3D: React.FC<Props> = ({ build, scenery, picking, marker, onPick, goTo, className }) => {
    const host = useRef<HTMLDivElement>(null);
    const three = useRef<{
        renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
        base?: ReturnType<typeof groupFrom>; scenery?: ReturnType<typeof groupFrom>; marker: THREE.Group; route?: Line2;
    } | null>(null);
    const [mode, setMode] = useState<Mode>('orbit');
    const [driving, setDriving] = useState(false);
    const [groundPrompt, setGroundPrompt] = useState(false);
    const [where, setWhere] = useState<number | null>(null); // distance shown in ground view
    // Mutable view state read by the render loop (refs avoid re-running effects every frame).
    const view = useRef({ mode: 'orbit' as Mode, s: 0, lat: 0, yaw: 0, pitch: -0.03, driving: false });
    const props = useRef({ build, picking, onPick, groundPrompt });
    props.current = { build, picking, onPick, groundPrompt };

    const cl = build.centerline;
    const defaultLat = cl.closed ? 0 : build.geometry.width / 4; // right-hand lane on a road

    // ---- helpers over the centreline (AC space)
    const helpers = useRef({
        index(s: number) {
            const c = props.current.build.centerline;
            let x = c.closed ? ((s % c.length) + c.length) % c.length : Math.max(0, Math.min(c.length, s));
            let lo = 0, hi = c.points.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.s[mid] <= x) lo = mid; else hi = mid - 1; }
            return lo;
        },
        /** Eye position (three space) at distance s, lateral offset lat. */
        eye(s: number, lat: number): THREE.Vector3 {
            const b = props.current.build, c = b.centerline;
            const i = this.index(s);
            const t = c.tangents[i], p = c.points[i];
            const x = p.x + t.y * lat, z = p.y - t.x * lat;
            return new THREE.Vector3(x, b.geometry.surfaceAt(i, lat) + EYE, -z);
        },
        heading(s: number) { const c = props.current.build.centerline; const t = c.tangents[this.index(s)]; return Math.atan2(-t.x, t.y); },
        pickFromPoint(v: THREE.Vector3): TrackPick {
            const c = props.current.build.centerline;
            const ax = v.x, az = -v.z;
            let best = 0, bd = Infinity;
            for (let i = 0; i < c.points.length; i++) { const d = (c.points[i].x - ax) ** 2 + (c.points[i].y - az) ** 2; if (d < bd) { bd = d; best = i; } }
            const t = c.tangents[best];
            const lateral = (ax - c.points[best].x) * t.y + (az - c.points[best].y) * -t.x;
            return { s: c.s[best], lateral, index: best };
        },
    });

    const enterGround = (s: number, lat = defaultLat) => {
        const v = view.current;
        const fog = three.current?.scene.fog as THREE.Fog | undefined;
        if (fog) { fog.near = 300; fog.far = 2500; }
        v.mode = 'ground'; v.s = s; v.lat = lat; v.yaw = helpers.current.heading(s); v.pitch = -0.03;
        setMode('ground'); setWhere(Math.round(s)); setGroundPrompt(false);
    };
    const enterOrbit = () => {
        view.current.mode = 'orbit'; view.current.driving = false;
        setMode('orbit'); setDriving(false);
        frameOverview();
    };
    const step = (d: number) => {
        const v = view.current; const c = props.current.build.centerline;
        v.s = c.closed ? (((v.s + d) % c.length) + c.length) % c.length : Math.max(0, Math.min(c.length, v.s + d));
        v.yaw = helpers.current.heading(v.s);
        setWhere(Math.round(v.s));
    };

    function frameOverview() {
        const t = three.current; if (!t) return;
        const box = new THREE.Box3();
        t.base?.group.children.forEach((m) => { if (m.name.startsWith('1ROAD')) box.expandByObject(m); });
        const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.z, 50);
        // Fog scaled to the track so the overview isn't washed out; ground view pulls it in.
        (t.scene.fog as THREE.Fog).near = r * 1.5; (t.scene.fog as THREE.Fog).far = r * 4;
        t.controls.target.copy(c);
        t.controls.maxDistance = r * 4;
        // Back off far enough for the whole route to fit the narrower side of the view.
        const fov = (t.camera.fov * Math.PI) / 180, aspect = Math.min(1, t.camera.aspect);
        const dist = (r * 0.85) / Math.tan((fov * aspect) / 2);
        t.camera.position.set(c.x - dist * 0.12, c.y + dist * 0.82, c.z + dist * 0.56);
        t.camera.lookAt(c);
        t.controls.update();
    }

    // ---- renderer, scene, loop (once)
    useEffect(() => {
        const el = host.current!;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xa9c8e6);
        scene.fog = new THREE.Fog(0xa9c8e6, 400, 4500);
        scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x6b7a55, 2.6));
        const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
        sun.position.set(-0.5, 1, 0.35);
        scene.add(sun);
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI * 0.495;
        const markerGroup = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 8), new THREE.MeshBasicMaterial({ color: 0xd42428 }));
        pole.position.y = 3;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd42428 }));
        ball.position.y = 6.4;
        markerGroup.add(pole, ball);
        markerGroup.visible = false;
        scene.add(markerGroup);
        three.current = { renderer, scene, camera, controls, marker: markerGroup };

        const resize = () => {
            const w = el.clientWidth, h = el.clientHeight;
            renderer.setSize(w, h, false);
            renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
            camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
            if (three.current?.route) (three.current.route.material as LineMaterial).resolution.set(w, h);
        };
        const ro = new ResizeObserver(resize); ro.observe(el); resize();

        // Pointer: drag = look (ground) or orbit; click = pick; double-click = ground view.
        let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
        const ray = new THREE.Raycaster();
        const hit = (e: PointerEvent | MouseEvent) => {
            const r = renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(ndc, camera);
            const objs: THREE.Object3D[] = [];
            three.current?.base?.group.children.forEach((o) => objs.push(o));
            three.current?.scenery?.group.children.forEach((o) => objs.push(o));
            const h = ray.intersectObjects(objs, false)[0];
            return h ? h.point : null;
        };
        const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, yaw: view.current.yaw, pitch: view.current.pitch }; };
        const onMove = (e: PointerEvent) => {
            if (!down || view.current.mode !== 'ground' || !(e.buttons & 1)) return;
            view.current.yaw = down.yaw + (e.clientX - down.x) * 0.005;
            view.current.pitch = Math.max(-1.2, Math.min(1.2, down.pitch + (e.clientY - down.y) * 0.005));
        };
        const onUp = (e: PointerEvent) => {
            if (!down) return;
            const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
            down = null;
            if (moved > 5) return;
            const p = hit(e); if (!p) return;
            const pick = helpers.current.pickFromPoint(p);
            if (props.current.picking) props.current.onPick(pick);
            else if (props.current.groundPrompt) { const hw = props.current.build.geometry.width / 2; enterGroundRef.current(pick.s, Math.max(-hw, Math.min(hw, pick.lateral))); }
        };
        const onDbl = (e: MouseEvent) => {
            if (props.current.picking) return;
            const p = hit(e); if (!p) return;
            const pick = helpers.current.pickFromPoint(p);
            enterGroundRef.current(pick.s);
        };
        const onKey = (e: KeyboardEvent) => {
            if (view.current.mode !== 'ground' || (e.target as HTMLElement)?.closest('input,textarea,select')) return;
            if (e.key === 'w' || e.key === 'ArrowUp') { stepRef.current(5); e.preventDefault(); }
            if (e.key === 's' || e.key === 'ArrowDown') { stepRef.current(-5); e.preventDefault(); }
            if (e.key === 'a' || e.key === 'ArrowLeft') { view.current.yaw -= 0.08; e.preventDefault(); }
            if (e.key === 'd' || e.key === 'ArrowRight') { view.current.yaw += 0.08; e.preventDefault(); }
        };
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointermove', onMove);
        renderer.domElement.addEventListener('pointerup', onUp);
        renderer.domElement.addEventListener('dblclick', onDbl);
        renderer.domElement.tabIndex = 0;
        renderer.domElement.addEventListener('keydown', onKey);

        let raf = 0, last = performance.now(), shown = -1;
        const tick = (now: number) => {
            const dt = Math.min(0.1, (now - last) / 1000); last = now;
            const v = view.current;
            if (v.mode === 'ground') {
                controls.enabled = false;
                if (v.driving) {
                    const c = props.current.build.centerline;
                    let s = v.s + DRIVE_SPEED * dt;
                    if (!c.closed && s >= c.length) { s = c.length; v.driving = false; setDriving(false); }
                    v.s = c.closed ? s % c.length : s;
                    // Look at a point 18 m ahead so corners turn smoothly.
                    const ahead = helpers.current.eye(v.s + 18, v.lat), here = helpers.current.eye(v.s, v.lat);
                    v.yaw = Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z));
                    if (Math.round(v.s / 10) !== shown) { shown = Math.round(v.s / 10); setWhere(Math.round(v.s)); }
                }
                const p = helpers.current.eye(v.s, v.lat);
                camera.position.copy(p);
                const dir = new THREE.Vector3(-Math.sin(v.yaw) * Math.cos(v.pitch), Math.sin(v.pitch), -Math.cos(v.yaw) * Math.cos(v.pitch));
                camera.lookAt(p.clone().add(dir));
                if (three.current?.route) three.current.route.visible = false;
            } else {
                if (three.current?.route) three.current.route.visible = true;
                controls.enabled = true;
                controls.update();
            }
            renderer.render(scene, camera);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf); ro.disconnect();
            renderer.domElement.removeEventListener('keydown', onKey);
            three.current?.base?.dispose(); three.current?.scenery?.dispose();
            controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement);
            three.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Stable references for handlers created in the once-only effect.
    const enterGroundRef = useRef(enterGround); enterGroundRef.current = enterGround;
    const stepRef = useRef(step); stepRef.current = step;

    // ---- base track meshes
    useEffect(() => {
        const t = three.current; if (!t) return;
        t.base?.dispose(); if (t.base) t.scene.remove(t.base.group);
        t.base = groupFrom([...build.geometry.parts, ...build.terrain], build.materials, build.textures, t.renderer);
        t.scene.add(t.base.group);
        // Route highlight for the overview: a fat red line just above the road, drawn on top.
        if (t.route) { t.scene.remove(t.route); t.route.geometry.dispose(); (t.route.material as LineMaterial).dispose(); }
        const c = build.centerline, pts: number[] = [];
        for (let i = 0; i < c.points.length; i += 2) pts.push(c.points[i].x, build.geometry.surfaceAt(i, 0) + 1, -c.points[i].y);
        if (c.closed) pts.push(pts[0], pts[1], pts[2]);
        const lg = new LineGeometry(); lg.setPositions(pts);
        const lm = new LineMaterial({ color: 0xd42428, linewidth: 4, depthTest: false, transparent: true, opacity: 0.9 });
        lm.resolution.set(t.renderer.domElement.width, t.renderer.domElement.height);
        t.route = new Line2(lg, lm); t.route.renderOrder = 10; t.route.computeLineDistances();
        t.scene.add(t.route);
        if (view.current.mode === 'orbit') frameOverview();
        else step(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [build]);

    // ---- scenery meshes (rebuilt on every edit)
    useEffect(() => {
        const t = three.current; if (!t) return;
        t.scenery?.dispose(); if (t.scenery) t.scene.remove(t.scenery.group);
        t.scenery = groupFrom(scenery.parts, scenery.materials, scenery.textures, t.renderer);
        t.scene.add(t.scenery.group);
    }, [scenery]);

    // ---- pending-click marker
    useEffect(() => {
        const t = three.current; if (!t) return;
        if (marker == null) { t.marker.visible = false; return; }
        const p = helpers.current.eye(marker, 0);
        t.marker.position.set(p.x, p.y - EYE, p.z);
        t.marker.visible = true;
    }, [marker, build]);

    useEffect(() => { if (goTo) enterGround(goTo.s); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [goTo?.nonce]);

    const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-black/60 hover:bg-black/80 text-white flex items-center gap-1 backdrop-blur';
    return (
        <div className={`relative ${className ?? ''}`}>
            <div ref={host} className={`absolute inset-0 ${picking || groundPrompt ? 'cursor-crosshair' : mode === 'ground' ? 'cursor-grab' : 'cursor-default'}`} />
            <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                {mode === 'orbit' ? (
                    <button type="button" className={`${btn} ${groundPrompt ? '!bg-[#2D9E49]' : ''}`} onClick={() => setGroundPrompt((v) => !v)}><Eye className="w-3.5 h-3.5" /> {groundPrompt ? 'Click a spot on the track' : 'Ground view'}</button>
                ) : (<>
                    <button type="button" className={btn} onClick={enterOrbit}><Globe2 className="w-3.5 h-3.5" /> Overview</button>
                    <button type="button" className={btn} onClick={() => step(-25)}><ChevronLeft className="w-3.5 h-3.5" /> 25 m</button>
                    <button type="button" className={btn} onClick={() => step(25)}>25 m <ChevronRight className="w-3.5 h-3.5" /></button>
                    <button type="button" className={btn} title="Open Google Street View at this spot, facing the same way (reference only)" onClick={() => openStreetView(build, view.current.s)}><MapPinned className="w-3.5 h-3.5" /> Street View</button>
                    <button type="button" className={btn} onClick={() => { const d = !view.current.driving; view.current.driving = d; setDriving(d); }}>
                        {driving ? <><Pause className="w-3.5 h-3.5" /> Stop</> : <><Car className="w-3.5 h-3.5" /> Drive</>}
                    </button>
                </>)}
            </div>
            <div className="absolute bottom-3 left-3 text-[11px] text-white/80 bg-black/50 rounded-md px-2 py-1 backdrop-blur pointer-events-none">
                {mode === 'ground'
                    ? `${where ?? 0} m of ${Math.round(cl.length)} m · drag to look · W/S to move`
                    : picking ? 'Click the track to place' : 'Drag to orbit · scroll to zoom · double-click to stand there'}
            </div>
        </div>
    );
};

export default TrackPreview3D;
