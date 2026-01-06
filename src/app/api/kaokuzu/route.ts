import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'kaokuzu');

// Ensure data directory exists (may fail on read-only filesystems like Vercel)
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
} catch (e) {
    console.log('Cannot create data directory (read-only filesystem)');
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const name = searchParams.get('name');

        if (name) {
            const filePath = path.join(DATA_DIR, `${name}.json`);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                return NextResponse.json({ data: JSON.parse(content) });
            } else {
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }
        } else {
            if (!fs.existsSync(DATA_DIR)) {
                return NextResponse.json({ files: [] });
            }
            const files = fs.readdirSync(DATA_DIR);
            const kaokuzu = files
                .filter((file) => file.endsWith('.json'))
                .map((file) => file.replace('.json', ''));
            return NextResponse.json({ files: kaokuzu });
        }
    } catch (error) {
        console.error('Kaokuzu GET error:', error);
        return NextResponse.json({ error: 'Failed to read', files: [] }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, data } = await request.json();

        if (!name || !data) {
            return NextResponse.json({ error: 'Name and data are required' }, { status: 400 });
        }

        // Check if directory exists, create if possible
        if (!fs.existsSync(DATA_DIR)) {
            try {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            } catch (e) {
                return NextResponse.json({ error: 'Cannot write to filesystem (Vercel read-only). Use localStorage instead.' }, { status: 503 });
            }
        }

        const filePath = path.join(DATA_DIR, `${name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Kaokuzu POST error:', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
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
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
}
