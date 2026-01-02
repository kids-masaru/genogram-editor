import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const text = formData.get('text') as string || '';
    const clientApiKey = formData.get('apiKey') as string || '';
    const fileEntries = formData.getAll('files') as File[];

    if (!text && fileEntries.length === 0) {
      return NextResponse.json({ error: 'テキストまたはファイルが必要です' }, { status: 400 });
    }

    // 環境変数を優先、なければクライアントから受け取ったキーを使用
    const apiKey = process.env.GEMINI_API_KEY || clientApiKey;

    if (!apiKey) {
      return NextResponse.json({ error: 'APIキーが設定されていません' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // プロンプトの構築
    const promptText = `あなたは家族構成を分析する専門家です。
以下の入力（テキスト、音声、画像、PDFなど）を総合的に分析し、ジェノグラム（家族構成図）を作成するための情報をJSON形式で抽出してください。

【出力形式】
{
  "members": [
    {
      "id": "一意のID（例: self, father, mother, spouse, son1, daughter1等）",
      "name": "名前",
      "gender": "M（男性）/ F（女性）",
      "birthYear": 1960,
      "isDeceased": false,
      "isSelf": true,
      "isKeyPerson": false,
      "generation": 0,
      "note": "特記事項"
    }
  ],
  "marriages": [
    {
      "husband": "夫のID",
      "wife": "妻のID",
      "status": "married / divorced / separated / cohabitation",
      "children": ["子のID1", "子のID2"]
    }
  ]
}

【generationのルール】
- 本人の世代を0とする
- 本人の親世代は-1、祖父母は-2
- 本人の子世代は1、孫は2

【ルール】
- 本人（介護を受ける人）は isSelf: true にする
- 死亡している人は isDeceased: true にする
- 結婚・離婚はmarriagesで表現
- 子供はmarriagesのchildrenに含める
- 【重要】本人（または他の人物）の両親の情報がある場合、その両親が死別していても必ず 'marriages' に両親のペアを追加し、子供リストに本人を含めること。これがないと親子線が描画されません。
- 手書きの図やアセスメントシートが含まれる場合、そこから読み取れる家族関係を網羅してください。
- 音声データが含まれる場合、会話内容から家族関係を聴き取って反映してください。

【推論ルール】
- 文脈から「独立」「家を出た」「別居」などで配偶者や子供の存在が示唆される場合、**名前がなくても配偶者ノード（「夫」「妻」など）を作成し、marriageを追加してください**。これにより家系図の線が正しく引かれます。
- 子供（息子・娘）がいる人物には、必ず配偶者を追加してmarriage関係を作成してください。片親しか情報がない場合でも、親子線を描画するために配偶者（「妻」「夫」など）とのmarriageが必要です。
- 情報が不足している場合でも、家系図として成立するように合理的な推測を行って補完してください。

【入力情報】
${text}

JSONのみを出力してください。説明は不要です。`;

    // マルチモーダル入力パーツの作成
    const parts: any[] = [{ text: promptText }];

    for (const file of fileEntries) {
      if (file.size > 0) {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const base64Data = buffer.toString('base64');

        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: file.type,
          },
        });
      }
    }

    const result = await model.generateContent(parts);
    const responseText = result.response.text().trim();

    // JSONを抽出
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    } else {
      const braceMatch = responseText.match(/(\{[\s\S]*\})/);
      if (braceMatch) {
        jsonText = braceMatch[1].trim();
      }
    }

    const data = JSON.parse(jsonText);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('AI生成エラー:', error);
    return NextResponse.json(
      { error: error.message || 'AI生成に失敗しました' },
      { status: 500 }
    );
  }
}
