
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables directly from .env file
const envPath = path.resolve(__dirname, '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
for (const k in envConfig) {
  process.env[k] = envConfig[k];
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase credentials missing!');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectDoc() {
    const docId = '245bd5c9-7303-43e7-85ca-f52aa59566f2';
    
    console.log(`Inspecting docId: ${docId}`);
    
    // 1. Check if document exists
    const { data: doc, error: docError } = await supabase
        .from('documents')
        .select('id, title')
        .eq('id', docId)
        .single();
    
    if (docError) {
        console.error('Document lookup error:', docError.message);
    } else {
        console.log('Document found:', doc.title);
    }

    // 2. Check chunk count
    const { data: chunks, error: chunkError, count } = await supabase
        .from('chunks')
        .select('content', { count: 'exact' })
        .eq('document_id', docId);
    
    if (chunkError) {
        console.error('Error fetching chunks:', chunkError.message);
    } else {
        console.log('Total chunks for doc:', chunks.length);
        if (chunks.length > 0) {
            console.log('Sample chunk content length:', chunks[0].content.length);
            console.log('Sample chunk snippet:', chunks[0].content.slice(0, 100));
        }
    }
}

inspectDoc();
