// Supabase/PostgREST-style compatibility route.
// Supports apikey / Authorization: Bearer headers plus x-api-key.
// Internally reuses the hardened table REST handler.
import tableHandler from "../../tables/[table].js";

export default tableHandler;
