'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Group, Circle, Path, Line, Image as KonvaImage, Transformer } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import LZString from 'lz-string';
import AIInputPanel from './AIInputPanel';

// --- Types ---
export type MarkerType = 'Paralysis' | 'Missing' | 'FunctionLoss' | 'Comment';

export interface BodyMarker {
    id: string;
    x: number;
    y: number;
    type: MarkerType;
    text: string;
    view: 'front' | 'back';
    points?: number[]; // For freehand drawing (relative to group center)
}

export interface BodyMapData {
    markers: BodyMarker[];
    scale: number;
}

const MARKER_CONFIG: Record<MarkerType, { label: string, color: string, icon: string, bgColor: string }> = {
    Paralysis: { label: 'マヒ', color: '#ef4444', icon: '⚡', bgColor: 'rgba(239, 68, 68, 0.3)' },
    Missing: { label: '欠損', color: '#3b82f6', icon: '❌', bgColor: 'rgba(59, 130, 246, 0.3)' },
    FunctionLoss: { label: '機能低下', color: '#eab308', icon: '⚠️', bgColor: 'rgba(234, 179, 8, 0.3)' },
    Comment: { label: 'コメント', color: '#6b7280', icon: '💬', bgColor: 'rgba(107, 114, 128, 0.3)' }
};

// Helper: Rough Circle for AI
const generateRoughCircle = (radius: number = 30) => {
    const points: number[] = [];
    const segments = 12;
    for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const r = radius * (0.9 + Math.random() * 0.2);
        points.push(Math.cos(theta) * r);
        points.push(Math.sin(theta) * r);
    }
    return points;
};

// --- Body Image Component ---
const BodyMapImage = () => {
    const [image] = useImage('/body_template.png');
    return (
        <KonvaImage
            image={image}
            x={225}    // Centered horizontally: (1400 - 750) / 2 = 325? No, previous was 100 with width 1000. 
            // Original: 1000x800. 75% = 750x600.
            // Center 750 in 1400 canvas: (1400-750)/2 = 325. Let's use 325.
            y={150}    // Center 600 in 900 canvas: (900-600)/2 = 150.
            width={750}  // 75% of 1000
            height={600} // 75% of 800. Aspect ratio maintained (1000/800 = 1.25, 750/600 = 1.25)
            className="pointer-events-none"
            opacity={0.9}
        />
    );
};

export default function BodyMapEditor() {
    const [data, setData] = useState<BodyMapData>({ markers: [], scale: 1 });
    const [history, setHistory] = useState<BodyMapData[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const stageRef = useRef<Konva.Stage>(null);
    const trRef = useRef<Konva.Transformer>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedType, setSelectedType] = useState<MarkerType | null>(null);

    // Drawing State
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<number[]>([]);

    // AI & Storage
    const [showAIPanel, setShowAIPanel] = useState(false);
    const [showLoadModal, setShowLoadModal] = useState(false);
    const [savedFiles, setSavedFiles] = useState<string[]>([]);

    const pushHistory = (newData: BodyMapData) => {
        const newHist = history.slice(0, historyIndex + 1);
        newHist.push(newData);
        setHistory(newHist);
        setHistoryIndex(newHist.length - 1);
    };

    const updateData = (newData: BodyMapData) => {
        setData(newData);
        pushHistory(newData);
    };

    const undo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            setData(history[historyIndex - 1]);
            setSelectedId(null);
        }
    };

    const redo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            setData(history[historyIndex + 1]);
            setSelectedId(null);
        }
    };

    // Handle URL Params on Mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const encodedData = params.get('data');
        if (encodedData) {
            try {
                const jsonStr = LZString.decompressFromEncodedURIComponent(encodedData);
                if (jsonStr) {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.markers) {
                        updateData(parsed);
                    } else if (parsed.findings) {
                        handleAIGenerate(parsed);
                    }
                }
            } catch (e) {
                console.error("Failed to parse URL data", e);
            }
        } else {
            if (history.length === 0) pushHistory(data);
        }
    }, []);

    // useEffect(() => {
    //    if (history.length === 0) pushHistory(data);
    // }, []); // Replaced by the above to avoid double init if data present

    // Transformer & Keyboard Shortcuts
    useEffect(() => {
        if (selectedId && trRef.current && stageRef.current) {
            const node = stageRef.current.findOne('#' + selectedId);
            if (node) {
                trRef.current.nodes([node]);
                trRef.current.getLayer()?.batchDraw();
            }
        } else if (trRef.current) {
            trRef.current.nodes([]);
        }
    }, [selectedId, data]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) {
                    e.preventDefault();
                    redo();
                } else {
                    e.preventDefault();
                    undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedId) {
                    e.preventDefault();
                    deleteSelected();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [historyIndex, history, selectedId]);


    const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
        const clickedOnMarker = e.target.getParent()?.nodeType === 'Group' || e.target.nodeType === 'Group';

        if (clickedOnMarker && !selectedType) return; // Allow select

        if (selectedType) {
            setIsDrawing(true);
            const pos = e.target.getStage()?.getRelativePointerPosition();
            if (pos) {
                setCurrentPoints([pos.x, pos.y]);
            }
        } else {
            setSelectedId(null);
        }
    };

    const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!isDrawing || !selectedType) return;
        const stage = e.target.getStage();
        const point = stage?.getRelativePointerPosition();
        if (point) {
            setCurrentPoints(prev => [...prev, point.x, point.y]);
        }
    };

    const handleMouseUp = () => {
        if (isDrawing && selectedType) {
            setIsDrawing(false);
            if (currentPoints.length > 5) { // Lenient threshold
                // Calculate center
                const avgX = currentPoints.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (currentPoints.length / 2);
                const avgY = currentPoints.filter((_, i) => i % 2 !== 0).reduce((a, b) => a + b, 0) / (currentPoints.length / 2);

                // Normalize points relative to center
                const relPoints = currentPoints.map((val, i) => i % 2 === 0 ? val - avgX : val - avgY);

                const newMarker: BodyMarker = {
                    id: `marker_${Date.now()}`,
                    x: avgX,
                    y: avgY,
                    type: selectedType,
                    text: '',
                    view: avgX > 600 ? 'back' : 'front',
                    points: relPoints
                };
                updateData({ ...data, markers: [...data.markers, newMarker] });
                setSelectedId(newMarker.id);
            }
            setCurrentPoints([]);
            setSelectedType(null);
        }
    };

    const handleMarkerDragEnd = (e: Konva.KonvaEventObject<DragEvent>, id: string) => {
        const node = e.target;
        const { x, y } = node.position();

        updateData({
            ...data,
            markers: data.markers.map(m => {
                if (m.id === id) {
                    return { ...m, x: x, y: y }; // Simple update since points are relative
                }
                return m;
            })
        });
    };

    const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
        const node = e.target;
        const id = node.id();
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        const rotation = node.rotation();

        // Reset transform on node
        node.scaleX(1);
        node.scaleY(1);
        node.rotation(0);

        // Apply transform to points
        const marker = data.markers.find(m => m.id === id);
        if (marker && marker.points) {
            const newPoints: Array<number> = []; // Explicit type to fix build error
            const cos = Math.cos(rotation * Math.PI / 180);
            const sin = Math.sin(rotation * Math.PI / 180);

            for (let i = 0; i < marker.points.length; i += 2) {
                let px = marker.points[i] * scaleX;
                let py = marker.points[i + 1] * scaleY;

                // Rotate
                const rx = px * cos - py * sin;
                const ry = px * sin + py * cos;

                newPoints.push(rx);
                newPoints.push(ry);
            }
            updateData({
                ...data,
                markers: data.markers.map(m => m.id === id ? { ...m, points: newPoints } : m)
            });
        }
    };

    const updateSelectedText = (text: string) => {
        if (!selectedId) return;
        updateData({
            ...data,
            markers: data.markers.map(m => m.id === selectedId ? { ...m, text } : m)
        });
    };

    const deleteSelected = () => {
        if (!selectedId) return;
        updateData({
            ...data,
            markers: data.markers.filter(m => m.id !== selectedId)
        });
        setSelectedId(null);
    };

    const clearAll = () => {
        if (confirm("すべて消去しますか？")) {
            updateData({ ...data, markers: [] });
            setSelectedId(null);
        }
    }

    const saveToServer = async () => {
        const name = prompt('保存する名前を入力してください（例：田中氏_身体図）', '');
        if (!name) return;
        try {
            const res = await fetch('/api/body-maps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data }),
            });
            if (res.ok) alert('保存しました！');
            else alert('保存に失敗しました');
        } catch (e) { alert('エラーが発生しました'); }
    };

    const loadListFromServer = async () => {
        try {
            const res = await fetch('/api/body-maps');
            const json = await res.json();
            if (json.bodyMaps) {
                setSavedFiles(json.bodyMaps);
                setShowLoadModal(true);
            }
        } catch (e) { alert('一覧の取得に失敗しました'); }
    };

    const loadFileFromServer = async (name: string) => {
        try {
            const res = await fetch(`/api/body-maps?name=${name}&t=${Date.now()}`);
            const json = await res.json();
            if (json.data) {
                updateData(json.data);
                setShowLoadModal(false);
            } else alert('読込失敗');
        } catch (e) { alert('読込失敗'); }
    };

    const deleteFileFromServer = async (name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`「${name}」を完全に削除しますか？`)) return;
        try {
            const res = await fetch(`/api/body-maps?name=${name}`, { method: 'DELETE' });
            if (res.ok) setSavedFiles(prev => prev.filter(f => f !== name));
        } catch (e) { alert('削除エラー'); }
    };

    const exportImage = () => {
        if (!stageRef.current) return;
        const dataUrl = stageRef.current.toDataURL({ pixelRatio: 2 });
        const link = document.createElement('a');
        link.download = 'body_map.png';
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleAIGenerate = (aiData: any) => {
        const newMarkers: BodyMarker[] = [];
        // Adjusted for 75% scale (x=225, w=750)
        // Original: x=100, w=1000 -> Center Front ~350, Back ~850
        // New: x=225, w=750 (0.75 ratio) -> Offset Front ~187.5, Back ~562.5
        const CENTER_FRONT_X = 412;
        const CENTER_BACK_X = 788;

        // Adjusted Y (y=150, h=600)
        // Original: y=50, h=800 -> Center Y ~450
        // New: y=150, h=600 -> Offset ~300 -> Center Y = 450 (Unchanged coincidentally)
        const CENTER_Y = 450;

        const regions: any = {
            'head': { x: 0, y: -250 },
            'face': { x: 0, y: -250 },
            'neck': { x: 0, y: -200 },
            'shoulder': { x: -60, y: -180 },
            'right_shoulder': { x: 60, y: -180 },
            'left_shoulder': { x: -60, y: -180 },
            'chest': { x: 0, y: -100 },
            'stomach': { x: 0, y: 0 },
            'back': { x: 0, y: -100, view: 'back' },
            'hip': { x: 0, y: 50, view: 'back' },
            'leg': { x: -30, y: 300 },
            'right_leg': { x: 30, y: 300 },
            'left_leg': { x: -30, y: 300 },
            'arm': { x: -100, y: -50 },
            'hand': { x: -120, y: 50 },
        };

        if (aiData.findings && Array.isArray(aiData.findings)) {
            aiData.findings.forEach((f: any, i: number) => {
                const partKey = Object.keys(regions).find(k => f.part.includes(k)) || 'chest';
                const region = regions[partKey];
                let type: MarkerType = 'Comment';
                if (f.condition.includes('麻痺') || f.condition.includes('Paralysis')) type = 'Paralysis';
                else if (f.condition.includes('欠損') || f.condition.includes('Missing')) type = 'Missing';
                else if (f.condition.includes('機能') || f.condition.includes('Loss')) type = 'FunctionLoss';

                const baseX = region.view === 'back' ? CENTER_BACK_X : CENTER_FRONT_X;
                // const CENTER_Y = 450; // Use shared constant
                const cx = baseX + (region.x || 0);
                const cy = CENTER_Y + (region.y || 0);

                const points = generateRoughCircle(40);

                newMarkers.push({
                    id: `ai_${i}_${Date.now()}`,
                    x: cx,
                    y: cy,
                    type: type,
                    text: f.note || f.condition,
                    view: region.view || 'front',
                    points: points
                });
            });
            updateData({ ...data, markers: [...data.markers, ...newMarkers] });
        }
    };

    const selectedMarker = data.markers.find(m => m.id === selectedId);

    return (
        <div className="flex h-screen bg-gray-50 font-sans text-slate-700 overflow-hidden relative" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>
            <div className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 px-4 flex items-center shadow-sm z-50">
                <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-gray-700">CareDX Editor</span>
                </div>
                <div className="mx-6 h-6 w-px bg-gray-300"></div>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button onClick={() => window.location.href = '/'} className="px-4 py-1.5 text-gray-500 hover:text-gray-700 text-sm font-medium transition-all">👨‍👩‍👧‍👦 ジェノグラム</button>
                    <button onClick={() => window.location.href = '/house-plan'} className="px-4 py-1.5 text-gray-500 hover:text-gray-700 text-sm font-medium transition-all">🏠 家屋図</button>
                    <button className="px-4 py-1.5 bg-white text-blue-600 shadow-sm rounded-md text-sm font-bold transition-all">👤 身体図</button>
                </div>
            </div>

            <div className="absolute inset-0 pt-14 bg-slate-50 overflow-hidden cursor-crosshair">
                <Stage
                    width={1400}
                    height={900}
                    ref={stageRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                >
                    <Layer>
                        <BodyMapImage />
                        {data.markers.map(marker => {
                            const config = MARKER_CONFIG[marker.type];
                            return (
                                <Group
                                    key={marker.id}
                                    id={marker.id}
                                    name="marker-group" // Add name for click detection
                                    draggable
                                    onDragEnd={(e) => handleMarkerDragEnd(e, marker.id)}
                                    onTransformEnd={handleTransformEnd}
                                    onClick={(e) => { e.cancelBubble = true; setSelectedId(marker.id); }}
                                    x={marker.x}
                                    y={marker.y}
                                >
                                    {marker.points ? (
                                        <Line
                                            points={marker.points}
                                            stroke={config.color}
                                            strokeWidth={3}
                                            tension={0.5}
                                            closed
                                            fill={config.bgColor}
                                            opacity={selectedId === marker.id ? 1 : 0.8}
                                        />
                                    ) : (
                                        <Circle radius={20} fill={config.bgColor} stroke={config.color} strokeWidth={2} />
                                    )}
                                    {/* Text Box */}
                                    {(selectedId === marker.id || marker.text) && (
                                        <Group y={40}>
                                            <Rect
                                                width={Math.max(120, marker.text.length * 14)}
                                                height={30}
                                                fill="rgba(255,255,255,0.95)"
                                                cornerRadius={6}
                                                stroke="#ddd"
                                                shadowColor="black" shadowBlur={5} shadowOpacity={0.1}
                                                x={-60}
                                            />
                                            <Text
                                                text={marker.text || config.label}
                                                x={-50} y={8}
                                                fontSize={14}
                                                fill="#333"
                                            />
                                        </Group>
                                    )}
                                </Group>
                            );
                        })}
                        {isDrawing && (
                            <Line
                                points={currentPoints}
                                stroke={selectedType ? MARKER_CONFIG[selectedType].color : 'gray'}
                                strokeWidth={3}
                                tension={0.5}
                                dash={[10, 5]}
                            />
                        )}
                        <Transformer
                            ref={trRef}
                            boundBoxFunc={(oldBox: any, newBox: any) => {
                                if (newBox.width < 10 || newBox.height < 10) {
                                    return oldBox;
                                }
                                return newBox;
                            }}
                            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                            borderStroke="#0096FF"
                            anchorFill="#0096FF"
                            anchorSize={8}
                            rotateEnabled={true}
                        />
                    </Layer>
                </Stage>
            </div>

            <div className="absolute top-20 right-4 w-72 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col z-40 p-5">
                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <span>🖌️</span> 身体図エディタ
                </h2>

                <div className="mb-6">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">ペンツール (囲んで指定)</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {(Object.keys(MARKER_CONFIG) as MarkerType[]).map(type => (
                            <button
                                key={type}
                                onClick={() => setSelectedType(type)}
                                className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all h-20
                                    ${selectedType === type
                                        ? `bg-blue-50 border-${MARKER_CONFIG[type].color} ring-2 ring-blue-200 border-opacity-100`
                                        : 'bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-300'
                                    }`}
                                style={{ borderColor: selectedType === type ? MARKER_CONFIG[type].color : '' }}
                            >
                                <span className="text-2xl mb-1">{MARKER_CONFIG[type].icon}</span>
                                <span className="text-xs font-bold text-gray-600">{MARKER_CONFIG[type].label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mb-6 flex-1">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">詳細編集</h3>
                    {selectedMarker ? (
                        <div className="space-y-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-1 text-sm font-bold text-gray-700 border-b border-gray-200 pb-2">
                                <span>{MARKER_CONFIG[selectedMarker.type].icon}</span>
                                <span>{MARKER_CONFIG[selectedMarker.type].label}</span>
                            </div>
                            <textarea
                                className="w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-400 outline-none bg-white"
                                rows={3}
                                placeholder="詳細なコメントを入力..."
                                value={selectedMarker.text}
                                onChange={(e) => updateSelectedText(e.target.value)}
                            />
                            <button
                                onClick={deleteSelected}
                                className="w-full py-2 bg-white border border-red-200 text-red-600 rounded text-xs font-bold hover:bg-red-50 transition-colors"
                            >
                                🗑️ 削除
                            </button>
                        </div>
                    ) : (
                        <div className="text-sm text-center py-10 bg-gray-50 rounded-lg text-gray-400 border-2 border-dashed border-gray-200">
                            図上のマーカーをクリック<br />して編集
                        </div>
                    )}
                </div>

                <div className="mt-auto space-y-3 pt-4 border-t border-gray-100">

                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={saveToServer} className="py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-bold hover:bg-gray-50 flex items-center justify-center gap-1">💾 保存</button>
                        <button onClick={loadListFromServer} className="py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-bold hover:bg-gray-50 flex items-center justify-center gap-1">📂 読込</button>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={exportImage}
                            className="flex-1 py-2 bg-orange-50 text-orange-600 border border-orange-200 rounded-lg text-xs font-bold hover:bg-orange-100 transition-all"
                        >
                            📷 画像
                        </button>
                        <button
                            onClick={clearAll}
                            className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 transition-all"
                        >
                            🗑️ 全消去
                        </button>
                    </div>
                </div>
            </div>

            {showAIPanel && (
                <AIInputPanel
                    onGenerate={handleAIGenerate}
                    onClose={() => setShowAIPanel(false)}
                    mode="body_map"
                />
            )}

            {showLoadModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-md shadow-2xl transform transition-all scale-100">
                        <h3 className="font-bold mb-4 text-xl flex items-center gap-2 text-gray-800">
                            📂 保存された身体図
                        </h3>
                        <div className="max-h-[60vh] overflow-y-auto border border-gray-100 rounded-xl bg-gray-50">
                            {savedFiles.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">データがありません</div>
                            ) : (
                                <ul className="p-2 space-y-1">
                                    {savedFiles.map(file => (
                                        <li key={file} className="flex items-center group bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all overflow-hidden">
                                            <button
                                                onClick={() => loadFileFromServer(file)}
                                                className="flex-1 text-left p-3 text-gray-700 font-medium hover:text-blue-600 transition-colors flex items-center gap-2"
                                            >
                                                <span className="text-xl">📄</span> {file}
                                            </button>
                                            <button
                                                onClick={(e) => deleteFileFromServer(file, e)}
                                                className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors border-l border-gray-100"
                                                title="削除"
                                            >
                                                🗑️
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <button
                            onClick={() => setShowLoadModal(false)}
                            className="mt-6 w-full py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition-all shadow-lg shadow-gray-200"
                        >
                            閉じる
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
