
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
        console.error('Document not found:', docError);
    } else {
        console.log('Document found:', doc.title);
    }

    // 2. Check chunk count
    const { data: chunks, error: chunkError } = await supabase
        .from('chunks')
        .select('content', { count: 'exact' })
        .eq('document_id', docId);
    
    if (chunkError) {
        console.error('Error fetching chunks:', chunkError);
    } else {
        console.log('Total chunks for doc:', chunks.length);
        if (chunks.length > 0) {
            console.log('Sample chunk content:', chunks[0].content.slice(0, 100));
        }
    }
}

inspectDoc();
