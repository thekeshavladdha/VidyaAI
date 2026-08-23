
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkDoc() {
    const docId = '245bd5c9-7303-43e7-85ca-f52aa59566f2';
    const { data, error } = await supabase
        .from('chunks')
        .select('content')
        .eq('document_id', docId);
    
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Chunk count:', data.length);
        if (data.length > 0) {
            console.log('Sample chunk:', data[0].content.slice(0, 100));
        }
    }
}

checkDoc();
