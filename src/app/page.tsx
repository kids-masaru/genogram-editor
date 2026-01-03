'use client';

import { useState, useCallback, useRef, useMemo, useEffect, Suspense } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
  NodeTypes,
  ReactFlowProvider,
  Panel,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { useSearchParams } from 'next/navigation';
import LZString from 'lz-string';

import PersonNode from '@/components/nodes/PersonNode';
import MarriageNode from '@/components/nodes/MarriageNode';
import PropertyPanel from '@/components/PropertyPanel';
import RelationshipPanel from '@/components/RelationshipPanel';
import AIInputPanel from '@/components/AIInputPanel';
import { Person, Gender, Marriage } from '@/lib/types';
import { useHistory } from '@/hooks/useHistory';
import { convertToReactFlow } from '@/lib/genogram-utils';

// 初期ノード（サンプル）
const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

function GenogramEditorContent() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 履歴管理
  const { takeSnapshot, undo, redo, canUndo, canRedo } = useHistory(initialNodes, initialEdges);

  // 選択状態
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedMarriage, setSelectedMarriage] = useState<Marriage | null>(null);

  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedFiles, setSavedFiles] = useState<string[]>([]);

  const { getNodes, getEdges, fitView } = useReactFlow();

  // URLパラメータからのデータ読み込み
  useEffect(() => {
    const dataParam = searchParams.get('data');
    if (dataParam) {
      try {
        // スペースが+に変換されている場合があるので戻すなどの処理が必要なケースもあるが、
        // LZString.decompressFromEncodedURIComponentはURLセーフな文字を前提とするため通常はそのままでOK
        const decompressed = LZString.decompressFromEncodedURIComponent(dataParam);
        if (decompressed) {
          console.log('Data loaded from URL');
          const jsonData = JSON.parse(decompressed);
          const { nodes: newNodes, edges: newEdges } = convertToReactFlow(jsonData);

          setNodes(newNodes);
          setEdges(newEdges);

          // 少し待ってからフィット＆履歴保存
          setTimeout(() => {
            fitView({ padding: 0.2 });
            takeSnapshot(newNodes, newEdges);
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse data from URL', e);
      }
    }
  }, [searchParams, setNodes, setEdges, fitView, takeSnapshot]);

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      }
      // Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // カスタムノードタイプをメモ化
  const nodeTypes = useMemo<NodeTypes>(() => ({
    person: PersonNode,
    marriage: MarriageNode,
  }), []);

  // AI生成結果を適用
  const handleAIGenerate = useCallback(
    (newNodes: Node[], newEdges: Edge[]) => {
      takeSnapshot(nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      takeSnapshot(newNodes, newEdges);
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    },
    [setNodes, setEdges, nodes, edges, takeSnapshot, fitView]
  );

  // Undo
  const handleUndo = useCallback(() => {
    const state = undo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
      // 選択解除
      setSelectedPerson(null);
      setSelectedMarriage(null);
    }
  }, [undo, setNodes, setEdges]);

  // Redo
  const handleRedo = useCallback(() => {
    const state = redo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
      setSelectedPerson(null);
      setSelectedMarriage(null);
    }
  }, [redo, setNodes, setEdges]);

  // エッジ接続時 (手動接続ロジック)
  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot(nodes, edges);

      const sourceNode = nodes.find(n => n.id === connection.source);
      const targetNode = nodes.find(n => n.id === connection.target);

      // 人物同士の接続なら、間にMarriageNodeを自動挿入
      if (sourceNode?.type === 'person' && targetNode?.type === 'person') {
        const marriageId = `marriage_${Date.now()}`;

        // 厳密な水平調整：Y座標をソースノードに合わせる
        const alignY = sourceNode.position.y;

        // 中間地点（Xのみ計算）
        const midX = (sourceNode.position.x + targetNode.position.x) / 2;
        const midY = alignY; // ソースと同じ高さに設定

        const marriageNode: Node = {
          id: marriageId,
          type: 'marriage',
          position: { x: midX, y: midY },
          data: { status: 'married' },
          draggable: false, // ユーザーの要望により位置固定（ドラッグ不可）
        };

        const edge1: Edge = {
          id: `edge-${connection.source}-${marriageId}`,
          source: connection.source!,
          target: marriageId,
          sourceHandle: 'right-source',
          targetHandle: 'left-target',
          type: 'straight',
          style: { stroke: '#333', strokeWidth: 2 },
        };

        const edge2: Edge = {
          id: `edge-${connection.target}-${marriageId}`,
          source: connection.target!,
          target: marriageId,
          sourceHandle: 'left-source',
          targetHandle: 'right-target',
          type: 'straight',
          style: { stroke: '#333', strokeWidth: 2 },
        };

        // ハンドル位置の調整（左右関係）
        if (sourceNode.position.x < targetNode.position.x) {
          edge1.sourceHandle = 'right-source';
          edge1.targetHandle = 'left-target';
          edge2.source = targetNode.id;
          edge2.target = marriageId;
          edge2.sourceHandle = 'left-source';
          edge2.targetHandle = 'right-target';
        } else {
          edge1.sourceHandle = 'left-source';
          edge1.targetHandle = 'right-target';
          edge2.source = targetNode.id;
          edge2.target = marriageId;
          edge2.sourceHandle = 'right-source';
          edge2.targetHandle = 'left-target';
        }

        setNodes((nds) => {
          // ターゲットノードのY座標を強制的にソースに合わせる
          const newNodes = nds.map(n => {
            if (n.id === targetNode.id) {
              return {
                ...n,
                position: {
                  ...n.position,
                  y: alignY // Y座標を同期
                }
              };
            }
            if (n.id === sourceNode.id) {
              // ソースも念のため同じYにしておく（計算誤差排除）
              return {
                ...n,
                position: {
                  ...n.position,
                  y: alignY
                }
              };
            }
            return n;
          });
          return [...newNodes, marriageNode];
        });

        setEdges((eds) => [...eds, edge1, edge2]);

      } else {
        // 通常接続（親子など）
        const newEdge = {
          ...connection,
          type: 'smoothstep',
          style: { stroke: '#333', strokeWidth: 2 },
        };
        setEdges((eds) => addEdge(newEdge, eds));
      }

      setTimeout(() => {
        setEdges((currentEdges) => {
          takeSnapshot(nodes, currentEdges);
          return currentEdges;
        });
      }, 100);
    },
    [setEdges, nodes, edges, takeSnapshot, setNodes]
  );

  // ノード選択時
  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: Node) => {
      // 親のクリックイベント伝播を止める必要はないが、ReactFlow仕様に従う
      if (node.type === 'person' && node.data?.person) {
        setSelectedPerson(node.data.person);
        setSelectedMarriage(null);
      } else if (node.type === 'marriage') {
        const marriageId = node.id;
        const currentStatus = node.data.status || 'married';

        setSelectedMarriage({
          id: marriageId,
          husband: '',
          wife: '',
          status: currentStatus,
          children: []
        });
        setSelectedPerson(null);
      }
    },
    []
  );

  const addPerson = useCallback(
    (gender: Gender) => {
      takeSnapshot(nodes, edges);
      const id = `person_${Date.now()}`;
      const person: Person = {
        id,
        name: gender === 'M' ? '男性' : gender === 'F' ? '女性' : '不明',
        gender,
        isDeceased: false,
        isSelf: false,
        isKeyPerson: false,
        generation: 0,
      };

      // 画面中央に配置する計算 (viewportの中心)
      let posX = 100;
      let posY = 100;

      // reactFlowInstanceがなくても計算できるように簡易的なロジック
      // 本来は project() を使うと良いが、ここでは単純に既存ノードの平均位置やラッパーがあればそれを使う
      // しかしもっと単純に、現在表示されている領域の中心を取得したい
      // getNodes()で既存ノードがあれば、その最後のノードの近く、なければ(100,100)
      const currentNodes = getNodes();
      if (currentNodes.length > 0) {
        const lastNode = currentNodes[currentNodes.length - 1];
        posX = lastNode.position.x + 50;
        posY = lastNode.position.y + 50;
      }

      // もしgetNodesで取得できなければ、画面中央(とりあえず固定値よりはマシな位置)にしておく
      // const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); が理想だが...

      const newNode: Node = {
        id,
        type: 'person',
        position: { x: posX, y: posY },
        data: { person },
      };

      setNodes((nds) => [...nds, newNode]);
      setTimeout(() => takeSnapshot([...nodes, newNode], edges), 0);

      // 追加したノードが見えるように少し移動するか、選択状態にする
      setSelectedPerson(person);
      setSelectedMarriage(null);
    },
    [setNodes, nodes, edges, takeSnapshot, getNodes]
  );

  const updatePerson = useCallback(
    (updatedPerson: Person) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === updatedPerson.id
            ? { ...node, data: { ...node.data, person: updatedPerson } }
            : node
        )
      );
    },
    [setNodes]
  );

  const updateMarriage = useCallback(
    (updatedMarriage: Marriage) => {
      takeSnapshot(nodes, edges);
      setNodes((nds) =>
        nds.map((node) =>
          node.id === updatedMarriage.id
            ? { ...node, data: { ...node.data, status: updatedMarriage.status } }
            : node
        )
      );
      setSelectedMarriage(null);
      setTimeout(() => takeSnapshot(nodes, edges), 0);
    },
    [setNodes, nodes, edges, takeSnapshot]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      takeSnapshot(nodes, edges);
      setNodes((nds) => nds.filter((node) => node.id !== id));
      setEdges((eds) => eds.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedPerson(null);
      setSelectedMarriage(null);
      setTimeout(() => takeSnapshot(nodes, edges), 0);
    },
    [setNodes, setEdges, nodes, edges, takeSnapshot]
  );

  const deletePerson = (id: string) => handleDeleteNode(id);
  const deleteMarriage = (id: string) => handleDeleteNode(id);


  const clearAll = useCallback(() => {
    if (confirm('すべてクリアしますか？')) {
      takeSnapshot(nodes, edges);
      setNodes([]);
      setEdges([]);
      setTimeout(() => takeSnapshot([], []), 0);
    }
  }, [setNodes, setEdges, nodes, edges, takeSnapshot]);

  const exportPng = useCallback(async () => {
    if (reactFlowWrapper.current === null) {
      return;
    }

    // 1. 全体が見えるようにフィットさせる
    await fitView({ padding: 0.2, duration: 200 });

    // 2. レンダリング完了待ち（時間を延ばす）
    setTimeout(() => {
      const filter = (node: HTMLElement) => {
        return !node.classList?.contains('no-export');
      };

      const width = reactFlowWrapper.current!.offsetWidth;
      const height = reactFlowWrapper.current!.offsetHeight;

      toPng(reactFlowWrapper.current!, {
        cacheBust: true,
        backgroundColor: '#fff',
        filter,
        width: width,
        height: height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
        }
      })
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = 'genogram.png';
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => {
          console.error('oops, something went wrong!', err);
          alert('画像の保存に失敗しました');
        });
    }, 1000); // 300->1000msに延長

  }, [reactFlowWrapper, fitView]);

  const saveToServer = useCallback(async () => {
    const name = prompt('保存する名前を入力してください（例：田中家）', '');
    if (!name) return;

    const data = {
      nodes: getNodes(),
      edges: getEdges(),
    };

    try {
      const res = await fetch('/api/genograms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
      });
      if (res.ok) {
        alert('保存しました！');
      } else {
        alert('保存に失敗しました');
      }
    } catch (e) {
      alert('エラーが発生しました');
    }
  }, [getNodes, getEdges]);

  const loadListFromServer = useCallback(async () => {
    try {
      const res = await fetch('/api/genograms');
      const data = await res.json();
      if (data.genograms) {
        setSavedFiles(data.genograms);
        setShowLoadModal(true);
      }
    } catch (e) {
      alert('一覧の取得に失敗しました');
    }
  }, []);

  const loadFileFromServer = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/genograms?name=${name}&t=${Date.now()}`);
      const json = await res.json();
      if (json.data) {
        takeSnapshot(nodes, edges);
        setNodes(json.data.nodes || []);
        setEdges(json.data.edges || []);
        setShowLoadModal(false);
        setTimeout(() => {
          takeSnapshot(json.data.nodes, json.data.edges);
          fitView({ padding: 0.2 });
        }, 100);
      } else {
        alert('データの読み込みに失敗しました');
      }
    } catch (e) {
      alert('読込に失敗しました');
    }
  }, [setNodes, setEdges, nodes, edges, takeSnapshot, fitView]);

  const deleteFileFromServer = useCallback(async (name: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 親のボタンクリック（ロード）を防ぐ
    if (!confirm(`「${name}」を完全に削除しますか？`)) return;

    try {
      const res = await fetch(`/api/genograms?name=${name}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSavedFiles(prev => prev.filter(f => f !== name));
      } else {
        alert('削除できませんでした');
      }
    } catch (e) {
      alert('削除エラー');
    }
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
    },
    []
  );

  return (
    <div className="w-full h-screen relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: '#333', strokeWidth: 2 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#333', strokeWidth: 2 },
        }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background color="#e0e0e0" gap={20} className="no-export" />
        <Controls className="no-export" />

        <Panel position="top-center" className="no-export">
          <div style={{ background: 'white', padding: '8px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', margin: 0 }}>
              👨‍👩‍👧‍👦 ジェノグラムエディタ
            </h1>
          </div>
        </Panel>

        <Panel position="top-left" className="no-export">
          <div style={{
            background: 'white',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            minWidth: '160px'
          }}>
            <button
              onClick={() => setShowAIPanel(true)}
              style={{
                padding: '8px 10px', background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)', border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                color: 'white', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              <span>🤖</span> AI生成
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '8px' }}>
              <button
                onClick={() => addPerson('M')}
                style={{
                  padding: '6px', background: '#dbeafe', border: 'none',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'center'
                }}
              >
                🔲 男性
              </button>

              <button
                onClick={() => addPerson('F')}
                style={{
                  padding: '6px', background: '#fce7f3', border: 'none',
                  borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'center'
                }}
              >
                ⚪ 女性
              </button>
            </div>

            <button
              onClick={() => addPerson('U')}
              style={{
                padding: '6px', background: '#dcfce7', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'center', width: '100%', marginTop: '4px'
              }}
            >
              🔶 不明
            </button>

            <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={handleUndo} disabled={!canUndo} style={{ flex: 1, padding: '4px', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.5, border: '1px solid #ddd', borderRadius: '4px' }}>↩️</button>
              <button onClick={handleRedo} disabled={!canRedo} style={{ flex: 1, padding: '4px', cursor: canRedo ? 'pointer' : 'default', opacity: canRedo ? 1 : 0.5, border: '1px solid #ddd', borderRadius: '4px' }}>↪️</button>
            </div>

            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px', textAlign: 'center' }}>Ctrl+Z / Ctrl+Y</div>

            <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

            <button onClick={saveToServer} style={{ padding: '6px', background: '#f3f4f6', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'left' }}>💾 保存</button>
            <button onClick={loadListFromServer} style={{ padding: '6px', background: '#f3f4f6', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'left', marginTop: '4px' }}>📂 開く</button>
            <button onClick={exportPng} style={{ padding: '6px', background: '#e0f2fe', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'left', marginTop: '8px', color: '#0369a1' }}>🖼️ 画像保存</button>
            <button onClick={clearAll} style={{ padding: '6px', background: '#fee2e2', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', textAlign: 'left', marginTop: '8px', color: '#b91c1c' }}>🗑️ クリア</button>
          </div>
        </Panel>

        {/* プロパティパネルを右上に配置 */}
        {selectedPerson && (
          <Panel position="top-right" className="no-export">
            <PropertyPanel
              person={selectedPerson}
              onUpdate={updatePerson}
              onDelete={deletePerson}
              onClose={() => setSelectedPerson(null)}
            />
          </Panel>
        )}

        {selectedMarriage && (
          <Panel position="top-right" className="no-export">
            <RelationshipPanel
              marriage={selectedMarriage}
              onUpdate={updateMarriage}
              onDelete={deleteMarriage}
              onClose={() => setSelectedMarriage(null)}
            />
          </Panel>
        )}
      </ReactFlow>

      {showAIPanel && (
        <AIInputPanel
          onGenerate={handleAIGenerate}
          onClose={() => setShowAIPanel(false)}
        />
      )}

      {/* 読込モーダル */}
      {showLoadModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} className="no-export">
          <div style={{ background: 'white', padding: '20px', borderRadius: '8px', minWidth: '320px' }}>
            <h3 style={{ fontWeight: 'bold', marginBottom: '10px' }}>保存されたデータ</h3>
            <ul style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px', padding: 0 }}>
              {savedFiles.map(file => (
                <li key={file} style={{ listStyle: 'none', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={() => loadFileFromServer(file)}
                    style={{
                      flex: 1, textAlign: 'left', padding: '10px',
                      background: 'white', border: 'none',
                      cursor: 'pointer'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#f9fafb'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'white'}
                  >
                    📄 {file}
                  </button>
                  <button
                    onClick={(e) => deleteFileFromServer(file, e)}
                    style={{ padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                    title="削除"
                  >
                    🗑️
                  </button>
                </li>
              ))}
              {savedFiles.length === 0 && <li style={{ padding: '20px', color: '#999', textAlign: 'center', listStyle: 'none' }}>保存されたデータはありません</li>}
            </ul>
            <button
              onClick={() => setShowLoadModal(false)}
              style={{ marginTop: '10px', padding: '8px 16px', border: '1px solid #ccc', borderRadius: '4px', background: 'white', cursor: 'pointer', width: '100%' }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GenogramEditor() {
  return (
    <ReactFlowProvider>
      <Suspense fallback={<div>Loading...</div>}>
        <GenogramEditorContent />
      </Suspense>
    </ReactFlowProvider>
  );
}
