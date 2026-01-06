import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'body-maps');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const name = searchParams.get('name');

        if (name) {
            // 特定のファイルの内容を返す
            const filePath = path.join(DATA_DIR, `${name}.json`);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                return NextResponse.json({ data: JSON.parse(content) });
            } else {
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
        } else {
            // ファイル一覧を返す
            const files = fs.readdirSync(DATA_DIR);
            const bodyMaps = files
                .filter((file) => file.endsWith('.json'))
                .map((file) => file.replace('.json', ''));
            return NextResponse.json({ bodyMaps });
        }
    } catch (error) {
        return NextResponse.json({ error: 'Failed to operation' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, data } = await request.json();

        if (!name || !data) {
            return NextResponse.json({ error: 'Name and data are required' }, { status: 400 });
        }

        const filePath = path.join(DATA_DIR, `${name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to save body map' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const name = searchParams.get('name');

        if (!name) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        const filePath = path.join(DATA_DIR, `${name}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete body map' }, { status: 500 });
    }
}
