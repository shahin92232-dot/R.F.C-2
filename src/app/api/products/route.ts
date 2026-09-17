import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Lazy initialized Supabase Admin Client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export async function GET() {
  try {
    const { data: products, error } = await supabaseAdmin()
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ products: products || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, description, price, currency = 'USD', image_url, sku } = body;

    if (!title || price === undefined) {
      return NextResponse.json(
        { error: 'title and price are required' },
        { status: 400 }
      );
    }

    const { data: product, error } = await supabaseAdmin()
      .from('products')
      .insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        title,
        description: description || null,
        price: parseFloat(price),
        currency: currency || 'USD',
        image_url: image_url || null,
        sku: sku || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
