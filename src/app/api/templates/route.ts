import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Store templates in a dedicated subdirectory
const DATA_DIR = path.join(process.cwd(), 'data', 'templates');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const name = searchParams.get('name');

        if (name) {
            // Return specific file content
            const filePath = path.join(DATA_DIR, `${name}.json`);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                return NextResponse.json({ data: JSON.parse(content) });
            } else {
                return NextResponse.json({ error: 'Template not found' }, { status: 404 });
            }
        } else {
            // Return list of files
            if (!fs.existsSync(DATA_DIR)) {
                return NextResponse.json({ templates: [] });
            }
            const files = fs.readdirSync(DATA_DIR);
            const templates = files
                .filter((file) => file.endsWith('.json'))
                .map((file) => file.replace('.json', ''));
            return NextResponse.json({ templates });
        }
    } catch (error) {
        console.error('Template API Error:', error);
        return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { name, data } = await request.json();

        if (!name || !data) {
            return NextResponse.json({ error: 'Name and data are required' }, { status: 400 });
        }

        const filePath = path.join(DATA_DIR, `${name}.json`);
        // Saving the template data
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Template API Save Error:', error);
        return NextResponse.json({ error: 'Failed to save template' }, { status: 500 });
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
        console.error('Template API Delete Error:', error);
        return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
    }
}
